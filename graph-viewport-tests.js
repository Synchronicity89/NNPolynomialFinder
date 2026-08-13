(function () {
  const { GraphViewportController, buildTickValues, getNiceStep, evaluatePolynomial, mapRange } = window.GraphViewport;
  const contractResultsRoot = document.querySelector('#contract-results');
  const contractSummaryRoot = document.querySelector('#contract-summary');
  const probeResultsRoot = document.querySelector('#probe-results');
  const probeSummaryRoot = document.querySelector('#probe-summary');

  function appendResult(root, name, passed, details = '', label = passed ? 'PASS' : 'FAIL') {
    const item = document.createElement('li');
    item.className = passed ? 'pass' : 'fail';
    item.textContent = `${label}: ${name}${details ? ` | ${details}` : ''}`;
    root.appendChild(item);
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

  function assertFinite(value, message) {
    if (!Number.isFinite(value)) {
      throw new Error(`${message}. Expected a finite number, received ${value}`);
    }
  }

  const contractTests = [
    {
      name: 'screen and domain coordinates round-trip through the viewport',
      run() {
        const viewport = new GraphViewportController({ min: -4, max: 6 });
        const bounds = { min: -10, max: 20 };
        const screenPoint = viewport.toScreenPoint(1.5, -2, bounds, 360, 220);
        const domainPoint = viewport.toDomainPoint(screenPoint.x, screenPoint.y, bounds, 360, 220);

        assertClose(domainPoint.x, 1.5, 1e-9, 'domain x should survive a round trip');
        assertClose(domainPoint.y, -2, 1e-9, 'domain y should survive a round trip');
      },
    },
    {
      name: 'zoom keeps the anchor stable in screen space',
      run() {
        const viewport = new GraphViewportController({ min: -10, max: 10 });
        const anchorRatio = 0.25;
        const anchorBefore = viewport.getDomain().min + viewport.currentSpan() * anchorRatio;

        viewport.zoom(0.5, anchorRatio);

        const anchorAfter = viewport.getDomain().min + viewport.currentSpan() * anchorRatio;
        assertClose(anchorAfter, anchorBefore, 1e-9, 'zoom should preserve the anchored domain coordinate');
      },
    },
    {
      name: 'zoom clamps to the configured span limits',
      run() {
        const viewport = new GraphViewportController({ min: -2, max: 2 }, { minSpan: 1, maxSpan: 5 });
        viewport.zoom(0.01);
        assertClose(viewport.currentSpan(), 1, 1e-9, 'minimum span should clamp');

        viewport.zoom(100);
        assertClose(viewport.currentSpan(), 5, 1e-9, 'maximum span should clamp');
      },
    },
    {
      name: 'drag preserves span while translating the domain',
      run() {
        const viewport = new GraphViewportController({ min: -4, max: 4 });
        const initialSpan = viewport.currentSpan();
        viewport.startDrag(100, 9);
        viewport.updateDrag(160, 240);
        const domain = viewport.getDomain();

        assertClose(viewport.currentSpan(), initialSpan, 1e-9, 'drag should not change span');
        assertClose(domain.min, -6, 1e-9, 'drag should translate the minimum');
        assertClose(domain.max, 2, 1e-9, 'drag should translate the maximum');
        assertEqual(viewport.getDragPointerId(), 9, 'pointer id should be retained');
      },
    },
    {
      name: 'plot corners map to domain and bounds limits',
      run() {
        const viewport = new GraphViewportController({ min: -2, max: 8 });
        const bounds = { min: -5, max: 15 };
        const metrics = viewport.getPlotMetrics(400, 240);
        const bottomLeft = viewport.toDomainPoint(metrics.padding.left, 240 - metrics.padding.bottom, bounds, 400, 240);
        const topRight = viewport.toDomainPoint(400 - metrics.padding.right, metrics.padding.top, bounds, 400, 240);

        assertClose(bottomLeft.x, -2, 1e-9, 'bottom-left x should match the domain minimum');
        assertClose(bottomLeft.y, -5, 1e-9, 'bottom-left y should match the bounds minimum');
        assertClose(topRight.x, 8, 1e-9, 'top-right x should match the domain maximum');
        assertClose(topRight.y, 15, 1e-9, 'top-right y should match the bounds maximum');
      },
    },
    {
      name: 'plot-area hit testing includes the plot boundary and excludes the margin',
      run() {
        const viewport = new GraphViewportController({ min: -1, max: 1 });
        const rect = { left: 50, top: 25 };
        const metrics = viewport.getPlotMetrics(300, 200);

        assertEqual(viewport.isPointInPlotArea(rect.left + metrics.padding.left, rect.top + metrics.padding.top, rect, 300, 200), true, 'plot corner should count as inside');
        assertEqual(viewport.isPointInPlotArea(rect.left + metrics.padding.left - 1, rect.top + metrics.padding.top, rect, 300, 200), false, 'left margin should stay outside');
      },
    },
    {
      name: 'sampled bounds include both curves and add breathing room',
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
      name: 'axis lines align with tick values produced from the same ranges',
      run() {
        const viewport = new GraphViewportController({ min: -5, max: 5 });
        const axes = viewport.axisLines({ min: -10, max: 10 }, 400, 240);
        const expectedXTicks = buildTickValues(-5, 5, 6);
        const expectedYTicks = buildTickValues(-10, 10, 5);

        assertEqual(axes.vertical.length, expectedXTicks.length, 'vertical gridline count should match x ticks');
        assertEqual(axes.horizontal.length, expectedYTicks.length, 'horizontal gridline count should match y ticks');
        assertClose(axes.zeroX, mapRange(0, -5, 5, axes.metrics.padding.left, 400 - axes.metrics.padding.right), 1e-9, 'zero x-axis position should map correctly');
        assertClose(axes.zeroY, mapRange(0, -10, 10, 240 - axes.metrics.padding.bottom, axes.metrics.padding.top), 1e-9, 'zero y-axis position should map correctly');
      },
    },
    {
      name: 'curve points keep domain x monotonic across the canvas',
      run() {
        const viewport = new GraphViewportController({ min: -1, max: 1 });
        const { points, metrics } = viewport.curvePoints((x) => x, { min: -1, max: 1 }, 300, 200, 4);

        assertEqual(points.length, 5, 'curve point count should include both endpoints');
        assertClose(points[0].x, metrics.padding.left, 1e-9, 'first point x should start at plot left');
        assertClose(points[0].y, metrics.height - metrics.padding.bottom, 1e-9, 'first point y should map minimum bound');
        assertClose(points[4].x, metrics.width - metrics.padding.right, 1e-9, 'last point x should end at plot right');
        assertClose(points[4].y, metrics.padding.top, 1e-9, 'last point y should map maximum bound');
        assert(points.every((point, index) => index === 0 || point.x > points[index - 1].x), 'curve x coordinates should be strictly increasing');
      },
    },
    {
      name: 'sample points use the same transform as the plot geometry',
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
      name: 'tick helpers choose human-friendly steps around zero',
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

  const adversarialProbes = [
    {
      name: 'collapsed domains should not produce infinite zoom percentages',
      run() {
        const viewport = new GraphViewportController({ min: -2, max: 2 });
        viewport.setDomain(1, 1);
        assertFinite(viewport.getZoomPercent(), 'collapsed domain leaked into zoom reporting');
      },
    },
    {
      name: 'reversed domains should be rejected or normalized',
      run() {
        const viewport = new GraphViewportController({ min: -2, max: 2 });
        viewport.setDomain(3, -3);
        assert(viewport.currentSpan() > 0, 'reversed domain created a negative span');
      },
    },
    {
      name: 'NaN zoom factors should not corrupt the domain',
      run() {
        const viewport = new GraphViewportController({ min: -2, max: 2 });
        viewport.zoom(Number.NaN, 0.5);
        const domain = viewport.getDomain();
        assertFinite(domain.min, 'domain minimum became invalid after NaN zoom');
        assertFinite(domain.max, 'domain maximum became invalid after NaN zoom');
      },
    },
    {
      name: 'zero-step sampled bounds should stay finite or fail explicitly',
      run() {
        const viewport = new GraphViewportController({ min: -2, max: 2 });
        const bounds = viewport.sampledBounds((x) => x, null, 0);
        assertFinite(bounds.min, 'sampled bounds minimum became invalid for zero steps');
        assertFinite(bounds.max, 'sampled bounds maximum became invalid for zero steps');
      },
    },
  ];

  function runSuite(tests, root, summaryRoot, labels) {
    let passed = 0;

    for (const test of tests) {
      try {
        test.run();
        appendResult(root, test.name, true, '', labels.passLabel);
        passed += 1;
      } catch (error) {
        appendResult(root, test.name, false, error instanceof Error ? error.message : String(error), labels.failLabel);
      }
    }

    const failed = tests.length - passed;
    summaryRoot.textContent = `${passed}/${tests.length} ${labels.summaryNoun} passed`;
    summaryRoot.className = `summary ${failed === 0 ? 'pass' : 'fail'}`;
    return { passed, failed, total: tests.length };
  }

  const contractResults = runSuite(contractTests, contractResultsRoot, contractSummaryRoot, {
    passLabel: 'PASS',
    failLabel: 'FAIL',
    summaryNoun: 'contract tests',
  });

  const probeResults = runSuite(adversarialProbes, probeResultsRoot, probeSummaryRoot, {
    passLabel: 'NO WEAKNESS FOUND',
    failLabel: 'WEAKNESS FOUND',
    summaryNoun: 'adversarial probes',
  });

  window.__graphViewportTestResults = {
    contract: contractResults,
    probes: probeResults,
    totalPassed: contractResults.passed + probeResults.passed,
    totalFailed: contractResults.failed + probeResults.failed,
  };
})();