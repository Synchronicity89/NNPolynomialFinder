(function () {
  const DEFAULT_PADDING = { top: 34, right: 24, bottom: 34, left: 42 };

  function cloneDomain(domain) {
    return { min: domain.min, max: domain.max };
  }

  function mapRange(value, inputMin, inputMax, outputMin, outputMax) {
    if (inputMax === inputMin) {
      return outputMin;
    }

    const progress = (value - inputMin) / (inputMax - inputMin);
    return outputMin + (outputMax - outputMin) * progress;
  }

  function evaluatePolynomial(coefficients, x) {
    let total = 0;
    let xPower = 1;

    for (const coefficient of coefficients) {
      total += coefficient * xPower;
      xPower *= x;
    }

    return total;
  }

  function getNiceStep(span, targetLines = 6) {
    const safeSpan = Math.max(Math.abs(span), 1e-9);
    const roughStep = safeSpan / targetLines;
    const magnitude = Math.pow(10, Math.floor(Math.log10(roughStep)));
    const normalized = roughStep / magnitude;

    if (normalized <= 1) {
      return magnitude;
    }

    if (normalized <= 2) {
      return 2 * magnitude;
    }

    if (normalized <= 5) {
      return 5 * magnitude;
    }

    return 10 * magnitude;
  }

  function buildTickValues(min, max, targetLines = 6) {
    const step = getNiceStep(max - min, targetLines);
    const start = Math.ceil(min / step) * step;
    const ticks = [];

    for (let value = start; value <= max + step * 0.5; value += step) {
      ticks.push(Number(value.toFixed(10)));
    }

    return ticks;
  }

  function createPlotMetrics(width, height, padding = DEFAULT_PADDING) {
    const resolvedPadding = { ...DEFAULT_PADDING, ...padding };

    return {
      padding: resolvedPadding,
      width,
      height,
      plotWidth: width - resolvedPadding.left - resolvedPadding.right,
      plotHeight: height - resolvedPadding.top - resolvedPadding.bottom,
    };
  }

  class GraphViewportController {
    constructor(defaultDomain, options = {}) {
      this.minSpan = options.minSpan || 0.125;
      this.maxSpan = options.maxSpan || 64;
      this.padding = { ...DEFAULT_PADDING, ...(options.padding || {}) };
      this.drag = null;
      this.defaultDomain = cloneDomain(defaultDomain);
      this.domain = cloneDomain(defaultDomain);
    }

    setDefaultDomain(domain) {
      this.defaultDomain = cloneDomain(domain);
      this.domain = cloneDomain(domain);
      this.drag = null;
      return this.getDomain();
    }

    getDomain() {
      return cloneDomain(this.domain);
    }

    getPlotMetrics(width, height) {
      return createPlotMetrics(width, height, this.padding);
    }

    setDomain(min, max) {
      this.domain = { min, max };
      return this.getDomain();
    }

    currentSpan() {
      return this.domain.max - this.domain.min;
    }

    getZoomPercent() {
      const defaultSpan = this.defaultDomain.max - this.defaultDomain.min;
      return Math.round((defaultSpan / this.currentSpan()) * 100);
    }

    reset() {
      this.domain = cloneDomain(this.defaultDomain);
      this.drag = null;
      return this.getDomain();
    }

    zoom(scaleFactor, anchorRatio = 0.5) {
      const span = this.currentSpan();
      const nextSpan = Math.max(this.minSpan, Math.min(this.maxSpan, span * scaleFactor));

      if (Math.abs(nextSpan - span) < 1e-9) {
        return this.getDomain();
      }

      const anchorX = this.domain.min + span * anchorRatio;
      const nextMin = anchorX - nextSpan * anchorRatio;
      return this.setDomain(nextMin, nextMin + nextSpan);
    }

    startDrag(clientX, pointerId = null) {
      this.drag = {
        pointerId,
        startClientX: clientX,
        startDomain: this.getDomain(),
      };
    }

    updateDrag(clientX, plotWidth) {
      if (!this.drag || plotWidth <= 0) {
        return this.getDomain();
      }

      const deltaPixels = clientX - this.drag.startClientX;
      const domainSpan = this.drag.startDomain.max - this.drag.startDomain.min;
      const deltaX = (deltaPixels / plotWidth) * domainSpan;

      return this.setDomain(
        this.drag.startDomain.min - deltaX,
        this.drag.startDomain.max - deltaX,
      );
    }

    finishDrag() {
      this.drag = null;
    }

    isDragging() {
      return this.drag !== null;
    }

    getDragPointerId() {
      return this.drag ? this.drag.pointerId : undefined;
    }

    isPointInPlotArea(clientX, clientY, rect, width, height) {
      const metrics = this.getPlotMetrics(width, height);
      const offsetX = clientX - rect.left;
      const offsetY = clientY - rect.top;

      return offsetX >= metrics.padding.left
        && offsetX <= metrics.padding.left + metrics.plotWidth
        && offsetY >= metrics.padding.top
        && offsetY <= metrics.padding.top + metrics.plotHeight;
    }

    sampledBounds(targetEvaluator, discoveredEvaluator, steps = 240) {
      if (!targetEvaluator) {
        return { min: -1, max: 1 };
      }

      let min = Infinity;
      let max = -Infinity;

      for (let index = 0; index <= steps; index += 1) {
        const x = this.domain.min + ((this.domain.max - this.domain.min) * index) / steps;
        const targetValue = targetEvaluator(x);
        const discoveredValue = discoveredEvaluator ? discoveredEvaluator(x) : targetValue;

        min = Math.min(min, targetValue, discoveredValue);
        max = Math.max(max, targetValue, discoveredValue);
      }

      if (min === max) {
        return { min: min - 1, max: max + 1 };
      }

      const padding = Math.max(1, (max - min) * 0.14);
      return { min: min - padding, max: max + padding };
    }

    axisLines(bounds, width, height) {
      const metrics = this.getPlotMetrics(width, height);
      const xTicks = buildTickValues(this.domain.min, this.domain.max, 6);
      const yTicks = buildTickValues(bounds.min, bounds.max, 5);

      return {
        metrics,
        vertical: xTicks.map((value) => ({
          value,
          x: mapRange(value, this.domain.min, this.domain.max, metrics.padding.left, width - metrics.padding.right),
        })),
        horizontal: yTicks.map((value) => ({
          value,
          y: mapRange(value, bounds.min, bounds.max, height - metrics.padding.bottom, metrics.padding.top),
        })),
        zeroX: mapRange(0, this.domain.min, this.domain.max, metrics.padding.left, width - metrics.padding.right),
        zeroY: mapRange(0, bounds.min, bounds.max, height - metrics.padding.bottom, metrics.padding.top),
      };
    }

    curvePoints(evaluator, bounds, width, height, steps = Math.max(220, Math.round(width * 1.6))) {
      const metrics = this.getPlotMetrics(width, height);
      const points = [];

      for (let index = 0; index <= steps; index += 1) {
        const domainX = this.domain.min + ((this.domain.max - this.domain.min) * index) / steps;
        const domainY = evaluator(domainX);
        points.push({
          x: metrics.padding.left + ((domainX - this.domain.min) / (this.domain.max - this.domain.min)) * metrics.plotWidth,
          y: metrics.padding.top + ((bounds.max - domainY) / (bounds.max - bounds.min)) * metrics.plotHeight,
          domainX,
          domainY,
        });
      }

      return { metrics, points };
    }

    samplePoints(samples, bounds, width, height) {
      const metrics = this.getPlotMetrics(width, height);

      return {
        metrics,
        points: samples.map((sample) => ({
          x: metrics.padding.left + ((sample.x - this.domain.min) / (this.domain.max - this.domain.min)) * metrics.plotWidth,
          y: metrics.padding.top + ((bounds.max - sample.y) / (bounds.max - bounds.min)) * metrics.plotHeight,
          sample,
        })),
      };
    }
  }

  window.GraphViewport = {
    DEFAULT_PADDING,
    mapRange,
    evaluatePolynomial,
    getNiceStep,
    buildTickValues,
    createPlotMetrics,
    GraphViewportController,
  };
})();