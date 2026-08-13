const form = document.querySelector('#control-form');
const polynomialInput = document.querySelector('#polynomial-input');
const sampleCountInput = document.querySelector('#sample-count');
const epochCountInput = document.querySelector('#epoch-count');
const learningRateInput = document.querySelector('#learning-rate');
const trainingProfileInput = document.querySelector('#training-profile');
const modelDegreeInput = document.querySelector('#model-degree');
const xMinInput = document.querySelector('#x-min');
const xMaxInput = document.querySelector('#x-max');
const randomizationInput = document.querySelector('#randomization');
const integerModeInput = document.querySelector('#integer-mode');
const integerMethodInput = document.querySelector('#integer-method');
const strictIntegerWeightsInput = document.querySelector('#strict-integer-weights');
const assistTargetDegreeInput = document.querySelector('#assist-target-degree');
const assistAutoIntegerInput = document.querySelector('#assist-auto-integer');
const assistCandidateSelectionInput = document.querySelector('#assist-candidate-selection');
const assistExactSolverInput = document.querySelector('#assist-exact-solver');
const assistLocalSearchInput = document.querySelector('#assist-local-search');
const trainButton = document.querySelector('#train-button');
const statusText = document.querySelector('#status-text');
const targetEquation = document.querySelector('#target-equation');
const discoveredEquation = document.querySelector('#discovered-equation');
const sampleSummary = document.querySelector('#sample-summary');
const lossSummary = document.querySelector('#loss-summary');
const canvas = document.querySelector('#graph-canvas');
const graphCoordinates = document.querySelector('#graph-coordinates');
const zoomInButton = document.querySelector('#zoom-in');
const zoomOutButton = document.querySelector('#zoom-out');
const zoomResetButton = document.querySelector('#zoom-reset');
const zoomLevelLabel = document.querySelector('#zoom-level');

if (!form || !polynomialInput || !sampleCountInput || !epochCountInput || !learningRateInput || !trainingProfileInput || !modelDegreeInput || !xMinInput || !xMaxInput || !randomizationInput || !integerModeInput || !integerMethodInput || !strictIntegerWeightsInput || !assistTargetDegreeInput || !assistAutoIntegerInput || !assistCandidateSelectionInput || !assistExactSolverInput || !assistLocalSearchInput || !trainButton || !statusText || !targetEquation || !discoveredEquation || !sampleSummary || !lossSummary || !canvas || !graphCoordinates || !zoomInButton || !zoomOutButton || !zoomResetButton || !zoomLevelLabel || !window.PolynomialFinder || !window.GraphViewport) {
  throw new Error('Polynomial Finder UI did not initialize correctly.');
}

const context = canvas.getContext('2d');
const graphViewport = new window.GraphViewport.GraphViewportController({ min: -2, max: 2 });
const integerMethodLabels = {
  'project-each-epoch': 'projected rounding',
  'annealed-bias': 'progressive snapping',
  'post-train-local-search': 'rounding plus local integer search',
};
const trainingProfileLabels = {
  'standard-sgd': 'Standard SGD',
  'adaptive-rms': 'Adaptive step scaling',
  'adaptive-rms-aggressive': 'Aggressive adaptive descent',
  'adaptive-rms-annealed-noise': 'Adaptive descent with annealed noise',
  'adaptive-rms-pulse-kicks': 'Adaptive descent with pulse kicks',
  'adaptive-rms-plateau-escape': 'Adaptive descent with plateau escape',
  'adaptive-rms-simplicity': 'Adaptive scaling with simplicity bias',
};
const CHEAT_DEPENDENT_INTEGER_METHOD = 'post-train-local-search';
const graphState = {
  target: null,
  model: null,
  samples: [],
  loss: 0,
  epoch: 0,
  epochs: 0,
  training: false,
  integerModeUserOverride: false,
  trainingOptions: null,
  bounds: { min: -1, max: 1 },
};

function getIntegerMethodLabel(method) {
  return integerMethodLabels[method] || 'integer search';
}

function getTrainingProfileLabel(profile) {
  return trainingProfileLabels[profile] || 'Adaptive step scaling';
}

function buildAssistSummary() {
  const enabledAssists = [];

  if (assistTargetDegreeInput.checked) {
    enabledAssists.push('target degree');
  }

  if (assistAutoIntegerInput.checked) {
    enabledAssists.push('auto integer mode');
  }

  if (assistCandidateSelectionInput.checked) {
    enabledAssists.push('candidate selection');
  }

  if (exactSolverEnabled()) {
    enabledAssists.push('exact solver');
  }

  if (localIntegerSearchEnabled()) {
    enabledAssists.push('local integer search');
  }

  return enabledAssists.length === 0
    ? 'Pure mode'
    : `Assisted mode: ${enabledAssists.join(', ')}`;
}

function assistedCandidateSelectionEnabled() {
  return assistCandidateSelectionInput.checked;
}

function exactSolverEnabled() {
  return assistedCandidateSelectionEnabled() && assistExactSolverInput.checked;
}

function localIntegerSearchEnabled() {
  return assistedCandidateSelectionEnabled() && assistLocalSearchInput.checked;
}

function updateIntegerMethodAvailability() {
  const integerModeEnabled = integerModeInput.checked;
  const localSearchOption = integerMethodInput.querySelector(`option[value="${CHEAT_DEPENDENT_INTEGER_METHOD}"]`);
  const postTrainAllowed = integerModeEnabled && localIntegerSearchEnabled();

  if (localSearchOption) {
    localSearchOption.disabled = !postTrainAllowed;
  }

  if (!postTrainAllowed && integerMethodInput.value === CHEAT_DEPENDENT_INTEGER_METHOD) {
    integerMethodInput.value = 'project-each-epoch';
  }

  integerMethodInput.disabled = graphState.training || !integerModeEnabled;
  strictIntegerWeightsInput.disabled = graphState.training || !integerModeEnabled;

  if (!integerModeEnabled) {
    strictIntegerWeightsInput.checked = false;
  }
}

function updateAssistAvailability() {
  const candidateSelectionEnabled = assistedCandidateSelectionEnabled();
  const integerModeEnabled = integerModeInput.checked;

  modelDegreeInput.disabled = graphState.training || assistTargetDegreeInput.checked;
  assistExactSolverInput.disabled = graphState.training || !candidateSelectionEnabled;
  assistLocalSearchInput.disabled = graphState.training || !candidateSelectionEnabled || !integerModeEnabled;

  if (!candidateSelectionEnabled) {
    assistExactSolverInput.checked = false;
    assistLocalSearchInput.checked = false;
  }

  if ((!candidateSelectionEnabled || !assistLocalSearchInput.checked) && integerMethodInput.value === CHEAT_DEPENDENT_INTEGER_METHOD) {
    integerMethodInput.value = 'project-each-epoch';
  }

  updateIntegerMethodAvailability();
}

function syncIntegerModeWithTarget(target) {
  if (assistAutoIntegerInput.checked && !graphState.integerModeUserOverride) {
    integerModeInput.checked = target.hasIntegerCoefficients;
  }

  if (assistTargetDegreeInput.checked) {
    modelDegreeInput.value = String(target.degree);
  }

  updateAssistAvailability();
  updateIntegerMethodAvailability();
}

function resolveModelDegree(target) {
  if (assistTargetDegreeInput.checked) {
    return target.degree;
  }

  const modelDegree = Number(modelDegreeInput.value);

  if (!Number.isInteger(modelDegree) || modelDegree < 0) {
    throw new Error('Set a whole-number model degree of 0 or greater.');
  }

  return modelDegree;
}

function updateZoomLabel() {
  zoomLevelLabel.textContent = `${graphViewport.getZoomPercent()}%`;
}

function applyViewportChange() {
  updateZoomLabel();
  renderGraph();
}

function resizeCanvas() {
  const rect = canvas.getBoundingClientRect();
  const scale = window.devicePixelRatio || 1;

  canvas.width = Math.max(1, Math.round(rect.width * scale));
  canvas.height = Math.max(1, Math.round(rect.height * scale));
  context.setTransform(scale, 0, 0, scale, 0, 0);
  renderGraph();
}

function formatNumber(value) {
  const rounded = Number(value.toFixed(4));
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(4).replace(/0+$/, '').replace(/\.$/, '');
}

function formatRangeValue(value) {
  const rounded = Number(value.toFixed(2));
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(2).replace(/0+$/, '').replace(/\.$/, '');
}

function formatAxisValue(value) {
  const rounded = Number(value.toFixed(3));
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(3).replace(/0+$/, '').replace(/\.$/, '');
}

function getDiscoveredEvaluator() {
  if (!graphState.model) {
    return null;
  }

  const discoveredCoefficients = graphState.model.coefficients(0);
  return (x) => window.GraphViewport.evaluatePolynomial(discoveredCoefficients, x);
}

function getBounds() {
  return graphViewport.sampledBounds(
    graphState.target ? graphState.target.evaluate.bind(graphState.target) : null,
    getDiscoveredEvaluator(),
  );
}

function drawAxes(bounds) {
  const lines = graphViewport.axisLines(bounds, canvas.clientWidth, canvas.clientHeight);
  const { metrics } = lines;

  context.strokeStyle = 'rgba(255, 255, 255, 0.16)';
  context.lineWidth = 1;

  for (const horizontal of lines.horizontal) {
    context.beginPath();
    context.moveTo(metrics.padding.left, horizontal.y);
    context.lineTo(metrics.width - metrics.padding.right, horizontal.y);
    context.stroke();
  }

  for (const vertical of lines.vertical) {
    context.beginPath();
    context.moveTo(vertical.x, metrics.padding.top);
    context.lineTo(vertical.x, metrics.height - metrics.padding.bottom);
    context.stroke();
  }

  context.strokeStyle = 'rgba(255, 255, 255, 0.5)';
  context.lineWidth = 1.5;

  if (lines.zeroX >= metrics.padding.left && lines.zeroX <= metrics.width - metrics.padding.right) {
    context.beginPath();
    context.moveTo(lines.zeroX, metrics.padding.top);
    context.lineTo(lines.zeroX, metrics.height - metrics.padding.bottom);
    context.stroke();
  }

  if (lines.zeroY >= metrics.padding.top && lines.zeroY <= metrics.height - metrics.padding.bottom) {
    context.beginPath();
    context.moveTo(metrics.padding.left, lines.zeroY);
    context.lineTo(metrics.width - metrics.padding.right, lines.zeroY);
    context.stroke();
  }

  context.fillStyle = 'rgba(244, 239, 232, 0.78)';
  context.font = '12px "Iowan Old Style", "Palatino Linotype", "Book Antiqua", Georgia, serif';
  context.textAlign = 'center';
  context.textBaseline = 'top';

  for (const vertical of lines.vertical) {
    context.fillText(
      formatAxisValue(vertical.value),
      vertical.x,
      metrics.height - metrics.padding.bottom + 8,
    );
  }

  context.textAlign = 'right';
  context.textBaseline = 'middle';

  for (const horizontal of lines.horizontal) {
    context.fillText(
      formatAxisValue(horizontal.value),
      metrics.padding.left - 8,
      horizontal.y,
    );
  }

  return lines.metrics;
}

function drawCurve(evaluator, strokeStyle, bounds, lineWidth = 3) {
  const { points } = graphViewport.curvePoints(evaluator, bounds, canvas.clientWidth, canvas.clientHeight);

  context.strokeStyle = strokeStyle;
  context.lineWidth = lineWidth;
  context.beginPath();

  points.forEach((point, index) => {
    if (index === 0) {
      context.moveTo(point.x, point.y);
    } else {
      context.lineTo(point.x, point.y);
    }
  });

  context.stroke();
}

function drawSamples(bounds) {
  const { points } = graphViewport.samplePoints(graphState.samples, bounds, canvas.clientWidth, canvas.clientHeight);

  context.fillStyle = 'rgba(255, 198, 92, 0.92)';
  for (const point of points) {
    context.beginPath();
    context.arc(point.x, point.y, 3.5, 0, Math.PI * 2);
    context.fill();
  }
}

function renderGraph() {
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;

  if (!width || !height) {
    return;
  }

  context.clearRect(0, 0, width, height);

  const gradient = context.createLinearGradient(0, 0, width, height);
  gradient.addColorStop(0, 'rgba(8, 13, 24, 0.94)');
  gradient.addColorStop(1, 'rgba(14, 21, 37, 0.98)');
  context.fillStyle = gradient;
  context.fillRect(0, 0, width, height);

  const bounds = getBounds();
  graphState.bounds = bounds;
  drawAxes(bounds);

  if (graphState.target) {
    drawCurve((x) => graphState.target.evaluate(x), 'rgba(255, 198, 92, 0.98)', bounds, 3.5);
  }

  const discoveredEvaluator = getDiscoveredEvaluator();
  if (discoveredEvaluator) {
    drawCurve(discoveredEvaluator, 'rgba(78, 201, 176, 0.98)', bounds, 3);
  }

  if (graphState.samples.length > 0) {
    drawSamples(bounds);
  }
}

function resetGraphCoordinates() {
  graphCoordinates.textContent = 'x: -, y: -';
}

function updateGraphCoordinates(event) {
  if (!graphState.target) {
    resetGraphCoordinates();
    return;
  }

  const rect = canvas.getBoundingClientRect();
  if (!graphViewport.isPointInPlotArea(event.clientX, event.clientY, rect, canvas.clientWidth, canvas.clientHeight)) {
    resetGraphCoordinates();
    return;
  }

  const point = graphViewport.toDomainPoint(
    event.clientX - rect.left,
    event.clientY - rect.top,
    graphState.bounds,
    canvas.clientWidth,
    canvas.clientHeight,
  );

  graphCoordinates.textContent = `x: ${formatAxisValue(point.x)}, y: ${formatAxisValue(point.y)}`;
}

function beginDrag(clientX, pointerId = null) {
  graphViewport.startDrag(clientX, pointerId);
  canvas.classList.add('is-dragging');
}

function updateDrag(clientX) {
  const metrics = graphViewport.getPlotMetrics(canvas.clientWidth, canvas.clientHeight);
  graphViewport.updateDrag(clientX, metrics.plotWidth);
  applyViewportChange();
}

function endDrag(pointerId = null) {
  if (pointerId !== null && canvas.hasPointerCapture(pointerId)) {
    canvas.releasePointerCapture(pointerId);
  }

  graphViewport.finishDrag();
  canvas.classList.remove('is-dragging');
}

function handlePointerDown(event) {
  if (!graphState.target || !graphViewport.isPointInPlotArea(event.clientX, event.clientY, canvas.getBoundingClientRect(), canvas.clientWidth, canvas.clientHeight)) {
    return;
  }

  beginDrag(event.clientX, event.pointerId);
  canvas.setPointerCapture(event.pointerId);
}

function handlePointerMove(event) {
  if (!graphViewport.isDragging() || graphViewport.getDragPointerId() !== event.pointerId) {
    return;
  }

  updateDrag(event.clientX);
}

function handlePointerEnd(event) {
  if (!graphViewport.isDragging() || graphViewport.getDragPointerId() !== event.pointerId) {
    return;
  }

  endDrag(event.pointerId);
}

function handleMouseDown(event) {
  if (event.button !== 0 || !graphState.target || !graphViewport.isPointInPlotArea(event.clientX, event.clientY, canvas.getBoundingClientRect(), canvas.clientWidth, canvas.clientHeight)) {
    return;
  }

  beginDrag(event.clientX);
}

function handleMouseMove(event) {
  if (!graphViewport.isDragging() || graphViewport.getDragPointerId() !== null) {
    return;
  }

  updateDrag(event.clientX);
}

function handleMouseUp() {
  if (!graphViewport.isDragging() || graphViewport.getDragPointerId() !== null) {
    return;
  }

  endDrag();
}

function updateSummary(target, model, loss, sampleCount) {
  const trainingMode = graphState.trainingOptions?.integerOnly
    ? `Integer mode: ${getIntegerMethodLabel(graphState.trainingOptions.integerMethod)}`
    : 'Continuous coefficients';
  const trainingProfile = graphState.trainingOptions?.trainingProfile
    ? ` | ${getTrainingProfileLabel(graphState.trainingOptions.trainingProfile)}`
    : '';
  const modelDegree = graphState.trainingOptions?.modelDegree !== undefined
    ? ` | model degree ${graphState.trainingOptions.modelDegree}`
    : '';
  const strictIntegerWeights = graphState.trainingOptions?.strictIntegerWeights
    ? ' | strict integer weights'
    : '';
  const coefficientThreshold = graphState.trainingOptions?.integerOnly ? 0 : 1e-5;
  const sampleRange = graphState.trainingOptions?.sampleRange || { min: -1, max: 1 };
  const randomization = graphState.trainingOptions?.randomization || 0;
  const randomizationText = randomization > 0 ? ` | randomization ${formatRangeValue(randomization)}` : '';
  const assistSummary = graphState.trainingOptions?.assistSummary
    ? ` | ${graphState.trainingOptions.assistSummary}`
    : '';

  targetEquation.textContent = target ? window.PolynomialFinder.formatPolynomial(target.coefficients) : 'f(x) = 0';
  discoveredEquation.textContent = model ? window.PolynomialFinder.formatPolynomial(model.coefficients(coefficientThreshold)) : 'Waiting for training...';
  sampleSummary.textContent = `${sampleCount} samples across x in [${formatRangeValue(sampleRange.min)}, ${formatRangeValue(sampleRange.max)}]${randomizationText} | ${trainingMode}${trainingProfile}${modelDegree}${strictIntegerWeights}${assistSummary}`;
  lossSummary.textContent = `Loss ${formatNumber(loss)}`;
}

function setStatus(message) {
  statusText.textContent = message;
}

function getStochasticStatusHint(model, trainingProfile) {
  const event = model?.lastTrainingEvent;

  if (!event) {
    return '';
  }

  if (event.plateauKickStdDev > 0) {
    return ` | plateau escape ${formatNumber(event.plateauKickStdDev)} at streak ${event.plateauStreak}`;
  }

  if (event.pulseStdDev > 0) {
    return ` | pulse kick ${formatNumber(event.pulseStdDev)}`;
  }

  if (trainingProfile === 'adaptive-rms-annealed-noise' && event.noiseStdDev > 0) {
    return ` | exploration noise ${formatNumber(event.noiseStdDev)}`;
  }

  return '';
}

async function trainModel(target, sampleCount, epochs, learningRate, trainingOptions) {
  const normalization = window.PolynomialFinder.createNormalization(trainingOptions.sampleRange);
  const model = new window.PolynomialFinder.PolynomialModel(trainingOptions.modelDegree, normalization);
  const samples = window.PolynomialFinder.createTrainingSamples(target.evaluate.bind(target), sampleCount, {
    range: trainingOptions.sampleRange,
    randomization: trainingOptions.randomization,
    normalization,
  });
  const leastSquaresWeights = trainingOptions.useExactSolverAssist
    ? window.PolynomialFinder.solveLeastSquaresPolynomial(samples, trainingOptions.modelDegree, 'featureX')
    : null;
  const rangeSpan = trainingOptions.sampleRange.max - trainingOptions.sampleRange.min;
  const xPadding = Math.max(0.5, rangeSpan * 0.15);

  graphViewport.setDefaultDomain({
    min: trainingOptions.sampleRange.min - xPadding,
    max: trainingOptions.sampleRange.max + xPadding,
  });

  graphState.target = target;
  graphState.model = model;
  graphState.samples = samples;
  graphState.loss = 0;
  graphState.epochs = epochs;
  graphState.epoch = 0;
  graphState.trainingOptions = trainingOptions;

  updateZoomLabel();
  updateSummary(target, model, 0, sampleCount);
  renderGraph();

  for (let epoch = 0; epoch < epochs; epoch += 1) {
    const loss = model.trainEpoch(samples, learningRate, {
      integerMethod: trainingOptions.integerOnly ? trainingOptions.integerMethod : 'continuous',
      strictIntegerWeights: trainingOptions.strictIntegerWeights,
      trainingProfile: trainingOptions.trainingProfile,
      epochProgress: epochs <= 1 ? 1 : epoch / (epochs - 1),
    });
    graphState.loss = loss;
    graphState.epoch = epoch + 1;

    if (epoch % 12 === 0 || epoch === epochs - 1) {
      updateSummary(target, model, loss, sampleCount);
      setStatus(`Epoch ${epoch + 1} of ${epochs} | loss ${formatNumber(loss)}${getStochasticStatusHint(model, trainingOptions.trainingProfile)}`);
      renderGraph();
      await new Promise((resolve) => window.requestAnimationFrame(resolve));
    }

    if (loss < 1e-10) {
      break;
    }
  }

  const modelDisplayWeights = model.coefficients(0);
  let finalDisplayWeights = modelDisplayWeights;

  if (trainingOptions.assistedCandidateSelection) {
    const candidates = [modelDisplayWeights];
    const leastSquaresDisplayWeights = leastSquaresWeights
      ? window.PolynomialFinder.modelToDisplayCoefficients(leastSquaresWeights, normalization)
      : null;

    if (trainingOptions.integerOnly) {
      if (trainingOptions.integerMethod === CHEAT_DEPENDENT_INTEGER_METHOD && trainingOptions.useLocalIntegerSearchAssist) {
        candidates.push(window.PolynomialFinder.localIntegerSearch(samples, modelDisplayWeights, { valueKey: 'x' }));

        if (leastSquaresDisplayWeights) {
          candidates.push(window.PolynomialFinder.localIntegerSearch(samples, leastSquaresDisplayWeights, { valueKey: 'x' }));
        }
      } else if (leastSquaresDisplayWeights) {
        candidates.push(window.PolynomialFinder.roundWeights(leastSquaresDisplayWeights));
      }
    } else if (leastSquaresDisplayWeights) {
      candidates.push(leastSquaresDisplayWeights);
    }

    finalDisplayWeights = window.PolynomialFinder.bestCandidateWeights(samples, candidates, { valueKey: 'x' });
  }

  if (trainingOptions.strictIntegerWeights) {
    finalDisplayWeights = window.PolynomialFinder.roundWeights(finalDisplayWeights);
  }

  model.applyDisplayWeights(finalDisplayWeights, true);

  const finalLoss = window.PolynomialFinder.meanSquaredError(samples, finalDisplayWeights, 'x');
  graphState.loss = finalLoss;
  updateSummary(target, model, finalLoss, sampleCount);
  setStatus(`Training complete | found ${window.PolynomialFinder.formatPolynomial(model.coefficients(trainingOptions.integerOnly ? 0 : 1e-5))}`);
  renderGraph();
}

async function handleSubmit(event) {
  event.preventDefault();

  if (graphState.training) {
    return;
  }

  const expression = polynomialInput.value.trim();
  const sampleCount = Number(sampleCountInput.value);
  const epochs = Number(epochCountInput.value);
  const learningRate = Number(learningRateInput.value);
  const trainingProfile = trainingProfileInput.value;
  const assistedCandidateSelection = assistedCandidateSelectionEnabled();
  const xMin = Number(xMinInput.value);
  const xMax = Number(xMaxInput.value);
  const randomization = Number(randomizationInput.value);

  try {
    if (!Number.isFinite(xMin) || !Number.isFinite(xMax) || xMin >= xMax) {
      throw new Error('Set an x range where the minimum is smaller than the maximum.');
    }

    if (!Number.isFinite(randomization) || randomization < 0 || randomization > 1) {
      throw new Error('Randomization must stay between 0 and 1.');
    }

    const target = window.PolynomialFinder.parsePolynomialExpression(expression);
    syncIntegerModeWithTarget(target);
    const modelDegree = resolveModelDegree(target);
    const trainingOptions = {
      integerOnly: integerModeInput.checked,
      integerMethod: integerMethodInput.value,
      strictIntegerWeights: integerModeInput.checked && strictIntegerWeightsInput.checked,
      trainingProfile,
      assistedCandidateSelection,
      useExactSolverAssist: exactSolverEnabled(),
      useLocalIntegerSearchAssist: localIntegerSearchEnabled(),
      modelDegree,
      assistSummary: buildAssistSummary(),
      sampleRange: { min: xMin, max: xMax },
      randomization,
    };

    graphState.training = true;
    trainButton.disabled = true;
    polynomialInput.disabled = true;
    sampleCountInput.disabled = true;
    epochCountInput.disabled = true;
    learningRateInput.disabled = true;
    trainingProfileInput.disabled = true;
    modelDegreeInput.disabled = true;
    xMinInput.disabled = true;
    xMaxInput.disabled = true;
    randomizationInput.disabled = true;
    integerModeInput.disabled = true;
    assistTargetDegreeInput.disabled = true;
    assistAutoIntegerInput.disabled = true;
    assistCandidateSelectionInput.disabled = true;
    assistExactSolverInput.disabled = true;
    assistLocalSearchInput.disabled = true;
    updateAssistAvailability();
    updateIntegerMethodAvailability();
    targetEquation.textContent = window.PolynomialFinder.formatPolynomial(target.coefficients);
    discoveredEquation.textContent = 'Training in progress...';
    setStatus(
      trainingOptions.integerOnly
        ? `Generating samples and fitting the model with ${getIntegerMethodLabel(trainingOptions.integerMethod)}, ${getTrainingProfileLabel(trainingOptions.trainingProfile)}, model degree ${trainingOptions.modelDegree}${trainingOptions.strictIntegerWeights ? ', strict integer weights' : ''}, and ${trainingOptions.assistSummary.toLowerCase()}.`
        : `Generating samples and fitting the model with ${getTrainingProfileLabel(trainingOptions.trainingProfile)}, model degree ${trainingOptions.modelDegree}, and ${trainingOptions.assistSummary.toLowerCase()}.`
    );

    await trainModel(target, sampleCount, epochs, learningRate, trainingOptions);
  } catch (error) {
    setStatus(error instanceof Error ? error.message : 'Unable to train the model.');
  } finally {
    graphState.training = false;
    trainButton.disabled = false;
    polynomialInput.disabled = false;
    sampleCountInput.disabled = false;
    epochCountInput.disabled = false;
    learningRateInput.disabled = false;
    trainingProfileInput.disabled = false;
    xMinInput.disabled = false;
    xMaxInput.disabled = false;
    randomizationInput.disabled = false;
    integerModeInput.disabled = false;
    modelDegreeInput.disabled = false;
    assistTargetDegreeInput.disabled = false;
    assistAutoIntegerInput.disabled = false;
    assistCandidateSelectionInput.disabled = false;
    assistExactSolverInput.disabled = false;
    assistLocalSearchInput.disabled = false;
    updateAssistAvailability();
    updateIntegerMethodAvailability();
  }
}

form.addEventListener('submit', handleSubmit);
polynomialInput.addEventListener('input', () => {
  try {
    const target = window.PolynomialFinder.parsePolynomialExpression(polynomialInput.value.trim());
    targetEquation.textContent = window.PolynomialFinder.formatPolynomial(target.coefficients);
    syncIntegerModeWithTarget(target);
  } catch {
    if (assistAutoIntegerInput.checked && !graphState.integerModeUserOverride) {
      integerModeInput.checked = false;
    }

    updateAssistAvailability();
    updateIntegerMethodAvailability();
  }
});
integerModeInput.addEventListener('change', () => {
  graphState.integerModeUserOverride = true;
  if (!integerModeInput.checked) {
    assistLocalSearchInput.checked = false;
  }
  updateAssistAvailability();
  updateIntegerMethodAvailability();
});
strictIntegerWeightsInput.addEventListener('change', () => {
  if (!integerModeInput.checked) {
    strictIntegerWeightsInput.checked = false;
  }
});
integerMethodInput.addEventListener('change', () => {
  graphState.integerModeUserOverride = true;
});
assistTargetDegreeInput.addEventListener('change', () => {
  try {
    const target = window.PolynomialFinder.parsePolynomialExpression(polynomialInput.value.trim());
    syncIntegerModeWithTarget(target);
  } catch {
    updateAssistAvailability();
  }
});
assistAutoIntegerInput.addEventListener('change', () => {
  graphState.integerModeUserOverride = false;
  try {
    const target = window.PolynomialFinder.parsePolynomialExpression(polynomialInput.value.trim());
    syncIntegerModeWithTarget(target);
  } catch {
    updateAssistAvailability();
  }
});
assistCandidateSelectionInput.addEventListener('change', updateAssistAvailability);
assistExactSolverInput.addEventListener('change', updateAssistAvailability);
assistLocalSearchInput.addEventListener('change', updateAssistAvailability);
zoomInButton.addEventListener('click', () => {
  graphViewport.zoom(0.75);
  applyViewportChange();
});
zoomOutButton.addEventListener('click', () => {
  graphViewport.zoom(1.3333333333);
  applyViewportChange();
});
zoomResetButton.addEventListener('click', () => {
  graphViewport.reset();
  applyViewportChange();
});
canvas.addEventListener('wheel', (event) => {
  event.preventDefault();

  const rect = canvas.getBoundingClientRect();
  const anchorRatio = rect.width <= 0 ? 0.5 : Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
  graphViewport.zoom(event.deltaY < 0 ? 0.85 : 1.15, anchorRatio);
  applyViewportChange();
}, { passive: false });
canvas.addEventListener('pointerdown', handlePointerDown);
canvas.addEventListener('pointermove', handlePointerMove);
canvas.addEventListener('pointerup', handlePointerEnd);
canvas.addEventListener('pointercancel', handlePointerEnd);
canvas.addEventListener('mousedown', handleMouseDown);
canvas.addEventListener('mousemove', updateGraphCoordinates);
canvas.addEventListener('mouseleave', resetGraphCoordinates);
window.addEventListener('mousemove', handleMouseMove);
window.addEventListener('mouseup', handleMouseUp);
window.addEventListener('resize', resizeCanvas);

try {
  syncIntegerModeWithTarget(window.PolynomialFinder.parsePolynomialExpression(polynomialInput.value.trim()));
} catch {
  if (assistAutoIntegerInput.checked) {
    integerModeInput.checked = false;
  }

  updateAssistAvailability();
  updateIntegerMethodAvailability();
}

updateAssistAvailability();
updateZoomLabel();
resizeCanvas();
handleSubmit(new Event('submit'));