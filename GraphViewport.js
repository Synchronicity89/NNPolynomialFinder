(function () {
  const DEFAULT_PADDING = { top: 34, right: 24, bottom: 34, left: 42 };

  function cloneDomain(domain) {
    return { min: domain.min, max: domain.max };
  }

  function isFiniteNumber(value) {
    return Number.isFinite(value);
  }

  function normalizeDomain(domain, fallbackSpan = 1) {
    const safeSpan = Math.max(Math.abs(fallbackSpan) || 1, 1e-9);

    if (!domain || !isFiniteNumber(domain.min) || !isFiniteNumber(domain.max)) {
      return { min: -safeSpan / 2, max: safeSpan / 2 };
    }

    if (domain.min === domain.max) {
      return {
        min: domain.min - safeSpan / 2,
        max: domain.max + safeSpan / 2,
      };
    }

    return domain.min < domain.max
      ? cloneDomain(domain)
      : { min: domain.max, max: domain.min };
  }

  function normalizeBounds(bounds) {
    return normalizeDomain(bounds, 2);
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
      this.defaultDomain = normalizeDomain(defaultDomain, this.minSpan);
      this.domain = cloneDomain(this.defaultDomain);
    }

    setDefaultDomain(domain) {
      this.defaultDomain = normalizeDomain(domain, this.minSpan);
      this.domain = cloneDomain(this.defaultDomain);
      this.drag = null;
      return this.getDomain();
    }

    getDomain() {
      return cloneDomain(this.domain);
    }

    getPlotMetrics(width, height) {
      return createPlotMetrics(width, height, this.padding);
    }

    toScreenPoint(domainX, domainY, bounds, width, height) {
      const metrics = this.getPlotMetrics(width, height);
      const safeBounds = normalizeBounds(bounds);

      return {
        x: mapRange(domainX, this.domain.min, this.domain.max, metrics.padding.left, width - metrics.padding.right),
        y: mapRange(domainY, safeBounds.min, safeBounds.max, height - metrics.padding.bottom, metrics.padding.top),
      };
    }

    toDomainPoint(screenX, screenY, bounds, width, height) {
      const metrics = this.getPlotMetrics(width, height);
      const safeBounds = normalizeBounds(bounds);

      return {
        x: mapRange(screenX, metrics.padding.left, width - metrics.padding.right, this.domain.min, this.domain.max),
        y: mapRange(screenY, height - metrics.padding.bottom, metrics.padding.top, safeBounds.min, safeBounds.max),
      };
    }

    setDomain(min, max) {
      this.domain = normalizeDomain({ min, max }, this.minSpan);
      return this.getDomain();
    }

    currentSpan() {
      return this.domain.max - this.domain.min;
    }

    getZoomPercent() {
      const defaultSpan = this.defaultDomain.max - this.defaultDomain.min;
      const span = this.currentSpan();

      if (!isFiniteNumber(span) || span <= 0) {
        return 100;
      }

      return Math.round((defaultSpan / span) * 100);
    }

    reset() {
      this.domain = cloneDomain(this.defaultDomain);
      this.drag = null;
      return this.getDomain();
    }

    zoom(scaleFactor, anchorRatio = 0.5) {
      const span = this.currentSpan();
      const safeScaleFactor = isFiniteNumber(scaleFactor) && scaleFactor > 0 ? scaleFactor : 1;
      const safeAnchorRatio = isFiniteNumber(anchorRatio) ? Math.max(0, Math.min(1, anchorRatio)) : 0.5;
      const nextSpan = Math.max(this.minSpan, Math.min(this.maxSpan, span * scaleFactor));

      if (!isFiniteNumber(span) || span <= 0) {
        return this.reset();
      }

      const clampedSpan = Math.max(this.minSpan, Math.min(this.maxSpan, span * safeScaleFactor));

      if (Math.abs(clampedSpan - span) < 1e-9) {
        return this.getDomain();
      }

      const anchorX = this.domain.min + span * safeAnchorRatio;
      const nextMin = anchorX - clampedSpan * safeAnchorRatio;
      return this.setDomain(nextMin, nextMin + clampedSpan);
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

      const safeSteps = Math.max(1, Math.floor(Number.isFinite(steps) ? steps : 240));

      let min = Infinity;
      let max = -Infinity;

      for (let index = 0; index <= safeSteps; index += 1) {
        const x = this.domain.min + ((this.domain.max - this.domain.min) * index) / safeSteps;
        const targetValue = targetEvaluator(x);
        const discoveredValue = discoveredEvaluator ? discoveredEvaluator(x) : targetValue;

        if (!isFiniteNumber(targetValue) || !isFiniteNumber(discoveredValue)) {
          continue;
        }

        min = Math.min(min, targetValue, discoveredValue);
        max = Math.max(max, targetValue, discoveredValue);
      }

      if (!isFiniteNumber(min) || !isFiniteNumber(max)) {
        return { min: -1, max: 1 };
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
          x: this.toScreenPoint(value, bounds.min, bounds, width, height).x,
        })),
        horizontal: yTicks.map((value) => ({
          value,
          y: this.toScreenPoint(this.domain.min, value, bounds, width, height).y,
        })),
        zeroX: this.toScreenPoint(0, bounds.min, bounds, width, height).x,
        zeroY: this.toScreenPoint(this.domain.min, 0, bounds, width, height).y,
      };
    }

    curvePoints(evaluator, bounds, width, height, steps = Math.max(220, Math.round(width * 1.6))) {
      const metrics = this.getPlotMetrics(width, height);
      const points = [];

      for (let index = 0; index <= steps; index += 1) {
        const domainX = this.domain.min + ((this.domain.max - this.domain.min) * index) / steps;
        const domainY = evaluator(domainX);
        const point = this.toScreenPoint(domainX, domainY, bounds, width, height);
        points.push({
          x: point.x,
          y: point.y,
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
        points: samples.map((sample) => {
          const point = this.toScreenPoint(sample.x, sample.y, bounds, width, height);
          return {
            x: point.x,
            y: point.y,
            sample,
          };
        }),
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