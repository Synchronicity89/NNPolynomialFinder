(function () {
  const { GraphViewportController, buildTickValues, getNiceStep, evaluatePolynomial } = window.GraphViewport;
  const resultsRoot = document.querySelector('#test-results');
  const summaryRoot = document.querySelector('#test-summary');

  function appendResult(name, passed, details = '') {
    const item = document.createElement('li');
    item.className = passed ? 'pass' : 'fail';
    item.textContent = passed ? `PASS: ${name}` : `FAIL: ${name}${details ? ` | ${details}` : ''}`;
    resultsRoot.appendChild(item);
  }

  function assert(condition, message) {
    if (!condition) {
      throw new Error(message);
    }
  }

  function assertClose(actual, expected, tolerance, message) {
    if (Math.abs(actual - expected) > tolerance) {
      throw new Error(`${message}. Expected ${expected}, received ${actual}`);
    }
  }

  function assertEqual(actual, expected, message) {
    if (actual !== expected) {
      throw new Error(`${message}. Expected ${expected}, received ${actual}`);
    }
  }

  const tests = [
    {
      name: 'zoom keeps anchor stable',
      run() {
        const viewport = new GraphViewportController({ min: -10, max: 10 });
        viewport.zoom(0.5, 0.25);
        const domain = viewport.getDomain();

        assertClose(domain.min, -7.5, 1e-9, 'zoomed minimum should preserve the anchor position');
        assertClose(domain.max, 2.5, 1e-9, 'zoomed maximum should preserve the anchor position');
        assertEqual(viewport.getZoomPercent(), 200, 'zoom percent should double when span halves');
      },
    },
    {
      name: 'zoom clamps to minimum and maximum span',
      run() {
        const viewport = new GraphViewportController({ min: -2, max: 2 }, { minSpan: 1, maxSpan: 5 });
        viewport.zoom(0.01);
        assertClose(viewport.currentSpan(), 1, 1e-9, 'minimum span should clamp');

        viewport.zoom(100);
        assertClose(viewport.currentSpan(), 5, 1e-9, 'maximum span should clamp');
      },
    },
    {
      name: 'reset restores the default domain',
      run() {
        const viewport = new GraphViewportController({ min: -3, max: 7 });
        viewport.zoom(0.5);
        viewport.reset();
        const domain = viewport.getDomain();

        assertClose(domain.min, -3, 1e-9, 'reset should restore minimum');
        assertClose(domain.max, 7, 1e-9, 'reset should restore maximum');
      },
    },
    {
      name: 'drag converts pixel movement into domain movement',
      run() {
        const viewport = new GraphViewportController({ min: -4, max: 4 });
        viewport.startDrag(100, 9);
        viewport.updateDrag(160, 240);
        const domain = viewport.getDomain();

        assertClose(domain.min, -6, 1e-9, 'drag should pan the left bound');
        assertClose(domain.max, 2, 1e-9, 'drag should pan the right bound');
        assertEqual(viewport.getDragPointerId(), 9, 'pointer id should be tracked while dragging');

        viewport.finishDrag();
        assertEqual(viewport.isDragging(), false, 'finishDrag should clear dragging state');
      },
    },
    {
      name: 'plot-area hit testing respects controller padding',
      run() {
        const viewport = new GraphViewportController({ min: -1, max: 1 });
        const rect = { left: 50, top: 25 };

        assertEqual(viewport.isPointInPlotArea(95, 80, rect, 300, 200), true, 'inner point should be inside');
        assertEqual(viewport.isPointInPlotArea(70, 40, rect, 300, 200), false, 'outer point should be outside');
      },
    },
    {
      name: 'sampled bounds include both evaluators and padding',
      run() {
        const viewport = new GraphViewportController({ min: -2, max: 2 });
        const bounds = viewport.sampledBounds(
          (x) => x * x,
          (x) => -2 * x,
          64,
        );

        assert(bounds.min < -4, 'minimum should include discovered curve padding');
        assert(bounds.max > 4, 'maximum should include target curve padding');
      },
    },
    {
      name: 'axis lines are generated from the current domain and bounds',
      run() {
        const viewport = new GraphViewportController({ min: -5, max: 5 });
        const axes = viewport.axisLines({ min: -10, max: 10 }, 400, 240);

        assert(axes.vertical.length >= 5, 'vertical gridlines should be generated');
        assert(axes.horizontal.length >= 4, 'horizontal gridlines should be generated');
        assertClose(axes.zeroX, 209, 1e-9, 'zero x-axis position should map correctly');
        assertClose(axes.zeroY, 120, 1e-9, 'zero y-axis position should map correctly');
      },
    },
    {
      name: 'curve points map domain values into canvas space',
      run() {
        const viewport = new GraphViewportController({ min: -1, max: 1 });
        const { points, metrics } = viewport.curvePoints((x) => x, { min: -1, max: 1 }, 300, 200, 4);

        assertEqual(points.length, 5, 'curve point count should include both endpoints');
        assertClose(points[0].x, metrics.padding.left, 1e-9, 'first point x should start at plot left');
        assertClose(points[0].y, metrics.height - metrics.padding.bottom, 1e-9, 'first point y should map minimum bound');
        assertClose(points[4].x, metrics.width - metrics.padding.right, 1e-9, 'last point x should end at plot right');
        assertClose(points[4].y, metrics.padding.top, 1e-9, 'last point y should map maximum bound');
      },
    },
    {
      name: 'sample points align with the same coordinate transform',
      run() {
        const viewport = new GraphViewportController({ min: -2, max: 2 });
        const { points, metrics } = viewport.samplePoints([
          { x: -2, y: -1 },
          { x: 0, y: 0 },
          { x: 2, y: 1 },
        ], { min: -1, max: 1 }, 360, 220);

        assertEqual(points.length, 3, 'all samples should be mapped');
        assertClose(points[1].x, metrics.padding.left + metrics.plotWidth / 2, 1e-9, 'center sample x should land in the middle');
        assertClose(points[1].y, metrics.padding.top + metrics.plotHeight / 2, 1e-9, 'center sample y should land in the middle');
      },
    },
    {
      name: 'tick helpers produce stable human-friendly steps',
      run() {
        assertClose(getNiceStep(37, 6), 10, 1e-9, 'nice step should round to 10');
        const ticks = buildTickValues(-4.5, 4.5, 6);

        assertEqual(ticks.includes(0), true, 'tick list should include zero when in range');
        assertEqual(ticks[0], -4, 'tick list should start on a rounded boundary');
      },
    },
    {
      name: 'polynomial evaluation is stable for ordered coefficients',
      run() {
        const value = evaluatePolynomial([3, -2, 5], 2);
        assertClose(value, 19, 1e-9, 'polynomial evaluation should use ascending powers');
      },
    },
  ];

  let passed = 0;

  for (const test of tests) {
    try {
      test.run();
      appendResult(test.name, true);
      passed += 1;
    } catch (error) {
      appendResult(test.name, false, error instanceof Error ? error.message : String(error));
    }
  }

  const failed = tests.length - passed;
  summaryRoot.textContent = `${passed}/${tests.length} tests passed`;
  summaryRoot.className = failed === 0 ? 'pass' : 'fail';
  window.__graphViewportTestResults = { passed, failed, total: tests.length };
})();