(function () {
    function isNearlyInteger(value, tolerance = 1e-9) {
        return Math.abs(value - Math.round(value)) <= tolerance;
    }

    function binomialCoefficient(n, k) {
        if (k < 0 || k > n) {
            return 0;
        }

        if (k === 0 || k === n) {
            return 1;
        }

        let result = 1;
        const limit = Math.min(k, n - k);

        for (let index = 1; index <= limit; index += 1) {
            result = (result * (n - limit + index)) / index;
        }

        return result;
    }

    function createNormalization(range = { min: -1, max: 1 }) {
        const scale = Math.max((range.max - range.min) / 2, 1e-9);

        return {
            center: (range.min + range.max) / 2,
            scale,
        };
    }

    function normalizeInput(x, normalization) {
        return (x - normalization.center) / normalization.scale;
    }

    function modelToDisplayCoefficients(modelWeights, normalization) {
        const displayWeights = new Float64Array(modelWeights.length);

        for (let sourceDegree = 0; sourceDegree < modelWeights.length; sourceDegree += 1) {
            const coefficient = modelWeights[sourceDegree] / Math.pow(normalization.scale, sourceDegree);

            for (let targetDegree = 0; targetDegree <= sourceDegree; targetDegree += 1) {
                displayWeights[targetDegree] += coefficient
                    * binomialCoefficient(sourceDegree, targetDegree)
                    * Math.pow(-normalization.center, sourceDegree - targetDegree);
            }
        }

        return displayWeights;
    }

    function displayToModelCoefficients(displayWeights, normalization) {
        const modelWeights = new Float64Array(displayWeights.length);

        for (let sourceDegree = 0; sourceDegree < displayWeights.length; sourceDegree += 1) {
            const coefficient = displayWeights[sourceDegree];

            for (let targetDegree = 0; targetDegree <= sourceDegree; targetDegree += 1) {
                modelWeights[targetDegree] += coefficient
                    * binomialCoefficient(sourceDegree, targetDegree)
                    * Math.pow(normalization.center, sourceDegree - targetDegree)
                    * Math.pow(normalization.scale, targetDegree);
            }
        }

        return modelWeights;
    }

    function parsePolynomialExpression(expression) {
        const compact = expression.replace(/\s+/g, '');

        if (!compact) {
            throw new Error('Enter a polynomial expression.');
        }

        const normalized = compact.replace(/-/g, '+-').replace(/^\+/, '');
        const terms = normalized.split('+').filter(Boolean);
        const coefficients = new Map();

        for (let term of terms) {
            let sign = 1;

            if (term.startsWith('-')) {
                sign = -1;
                term = term.slice(1);
            }

            const xIndex = term.indexOf('x');
            let coefficient;
            let degree;

            if (xIndex === -1) {
                coefficient = Number(term);
                degree = 0;
            } else {
                const rawCoefficient = term.slice(0, xIndex);
                coefficient = rawCoefficient === '' ? 1 : Number(rawCoefficient);
                degree = 1;

                if (term.slice(xIndex + 1).startsWith('^')) {
                    degree = Number(term.slice(xIndex + 2));
                }
            }

            if (!Number.isFinite(coefficient) || !Number.isFinite(degree) || degree < 0) {
                throw new Error(`Could not parse term: ${term}`);
            }

            if (!Number.isInteger(degree)) {
                throw new Error(`Polynomial exponents must be whole numbers. Problem term: ${term}`);
            }

            const current = coefficients.get(degree) || 0;
            coefficients.set(degree, current + sign * coefficient);
        }

        const maxDegree = Math.max(...coefficients.keys());
        const orderedCoefficients = Array.from({ length: maxDegree + 1 }, (_, degree) => coefficients.get(degree) || 0);

        return {
            coefficients: orderedCoefficients,
            degree: maxDegree,
            hasIntegerCoefficients: orderedCoefficients.every((value) => isNearlyInteger(value)),
            hasIntegerExponents: true,
            evaluate(x) {
                let y = 0;
                let xPower = 1;

                for (let degree = 0; degree < orderedCoefficients.length; degree += 1) {
                    y += orderedCoefficients[degree] * xPower;
                    xPower *= x;
                }

                return y;
            },
        };
    }

    function formatPolynomial(coefficients, threshold = 1e-6) {
        const parts = [];

        coefficients.forEach((value, degree) => {
            if (Math.abs(value) < threshold) {
                return;
            }

            const rounded = Number(value.toFixed(3));
            const magnitude = Math.abs(rounded);
            const formattedMagnitude = Number.isInteger(magnitude)
                ? String(magnitude)
                : magnitude.toFixed(3).replace(/0+$/, '').replace(/\.$/, '');
            const sign = rounded < 0 ? '-' : '+';
            let body = formattedMagnitude;

            if (degree === 1) {
                body = magnitude === 1 ? 'x' : `${formattedMagnitude}x`;
            } else if (degree > 1) {
                body = magnitude === 1 ? `x^${degree}` : `${formattedMagnitude}x^${degree}`;
            }

            parts.push({ sign, body });
        });

        if (parts.length === 0) {
            return 'f(x) = 0';
        }

        return parts.reduce((equation, part, index) => {
            if (index === 0) {
                return `f(x) = ${part.sign === '-' ? `-${part.body}` : part.body}`;
            }

            return `${equation} ${part.sign} ${part.body}`;
        }, '');
    }

    function createTrainingSamples(evaluate, sampleCount, options = {}) {
        const range = options.range || { min: -1, max: 1 };
        const randomization = Math.max(0, Number(options.randomization) || 0);
        const normalization = options.normalization || createNormalization(range);
        const baseSamples = [];
        const span = range.max - range.min;
        const step = sampleCount <= 1 ? span : span / (sampleCount - 1);

        for (let index = 0; index < sampleCount; index += 1) {
            const progress = sampleCount === 1 ? 0.5 : index / (sampleCount - 1);
            const x = range.min + span * progress;
            baseSamples.push({ x, y: evaluate(x), featureX: normalizeInput(x, normalization) });
        }

        const yScale = Math.max(1, ...baseSamples.map((sample) => Math.abs(sample.y)));
        const jitteredSamples = baseSamples.map((sample, index) => {
            if (randomization <= 0) {
                return sample;
            }

            const jitterWindow = index === 0 || index === sampleCount - 1 ? 0 : step * 0.45 * randomization;
            const xNoise = (Math.random() * 2 - 1) * jitterWindow;
            const nextX = Math.max(range.min, Math.min(range.max, sample.x + xNoise));
            const yNoise = (Math.random() * 2 - 1) * yScale * 0.2 * randomization;

            return {
                x: nextX,
                y: evaluate(nextX) + yNoise,
                featureX: normalizeInput(nextX, normalization),
            };
        });

        jitteredSamples.sort((left, right) => left.x - right.x);
        return jitteredSamples;
    }

    function cloneWeights(weights) {
        return Float64Array.from(weights);
    }

    function roundWeights(weights) {
        return Float64Array.from(weights, (value) => Math.round(value));
    }

    function solveLinearSystem(matrix, vector) {
        const size = vector.length;
        const augmented = matrix.map((row, rowIndex) => [...row, vector[rowIndex]]);

        for (let pivot = 0; pivot < size; pivot += 1) {
            let maxRow = pivot;

            for (let row = pivot + 1; row < size; row += 1) {
                if (Math.abs(augmented[row][pivot]) > Math.abs(augmented[maxRow][pivot])) {
                    maxRow = row;
                }
            }

            if (Math.abs(augmented[maxRow][pivot]) < 1e-12) {
                continue;
            }

            if (maxRow !== pivot) {
                [augmented[pivot], augmented[maxRow]] = [augmented[maxRow], augmented[pivot]];
            }

            const pivotValue = augmented[pivot][pivot];

            for (let column = pivot; column <= size; column += 1) {
                augmented[pivot][column] /= pivotValue;
            }

            for (let row = 0; row < size; row += 1) {
                if (row === pivot) {
                    continue;
                }

                const factor = augmented[row][pivot];

                for (let column = pivot; column <= size; column += 1) {
                    augmented[row][column] -= factor * augmented[pivot][column];
                }
            }
        }

        return Float64Array.from({ length: size }, (_, row) => augmented[row][size]);
    }

    function solveLeastSquaresPolynomial(samples, degree, valueKey = 'x') {
        const size = degree + 1;
        const matrix = Array.from({ length: size }, () => Array(size).fill(0));
        const vector = Array(size).fill(0);

        for (const sample of samples) {
            const powers = Array(size).fill(1);
            const xValue = valueKey === 'featureX' ? sample.featureX : sample.x;

            for (let power = 1; power < size; power += 1) {
                powers[power] = powers[power - 1] * xValue;
            }

            for (let row = 0; row < size; row += 1) {
                vector[row] += powers[row] * sample.y;

                for (let column = 0; column < size; column += 1) {
                    matrix[row][column] += powers[row] * powers[column];
                }
            }
        }

        for (let index = 0; index < size; index += 1) {
            matrix[index][index] += 1e-10;
        }

        return solveLinearSystem(matrix, vector);
    }

    function meanSquaredError(samples, weights, valueKey = 'x') {
        let totalLoss = 0;

        for (const sample of samples) {
            let prediction = 0;
            let xPower = 1;
            const xValue = valueKey === 'featureX' ? sample.featureX : sample.x;

            for (let degree = 0; degree < weights.length; degree += 1) {
                prediction += weights[degree] * xPower;
                xPower *= xValue;
            }

            const error = prediction - sample.y;
            totalLoss += error * error;
        }

        return totalLoss / samples.length;
    }

    function localIntegerSearch(samples, seedWeights, options = {}) {
        const maxPasses = options.maxPasses || 20;
        const valueKey = options.valueKey || 'x';
        const bestWeights = roundWeights(seedWeights);
        let bestLoss = meanSquaredError(samples, bestWeights, valueKey);

        for (let pass = 0; pass < maxPasses; pass += 1) {
            let improved = false;

            for (let degree = 0; degree < bestWeights.length; degree += 1) {
                const current = bestWeights[degree];
                const candidateValues = [current - 1, current + 1];

                for (const candidateValue of candidateValues) {
                    const candidateWeights = cloneWeights(bestWeights);
                    candidateWeights[degree] = candidateValue;
                    const candidateLoss = meanSquaredError(samples, candidateWeights, valueKey);

                    if (candidateLoss + 1e-12 < bestLoss) {
                        bestWeights[degree] = candidateValue;
                        bestLoss = candidateLoss;
                        improved = true;
                    }
                }
            }

            if (!improved) {
                break;
            }
        }

        return bestWeights;
    }

    function bestCandidateWeights(samples, candidates, options = {}) {
        const valueKey = options.valueKey || 'x';
        let bestWeights = null;
        let bestLoss = Infinity;

        for (const candidate of candidates) {
            const loss = meanSquaredError(samples, candidate, valueKey);

            if (loss < bestLoss) {
                bestLoss = loss;
                bestWeights = candidate;
            }
        }

        return bestWeights ? cloneWeights(bestWeights) : new Float64Array(0);
    }

    class PolynomialModel {
        constructor(degree, normalization = createNormalization()) {
            this.degree = degree;
            this.normalization = normalization;
            this.weights = new Float64Array(degree + 1);
            this.shadowWeights = new Float64Array(degree + 1);

            for (let index = 0; index <= degree; index += 1) {
                const initialWeight = (Math.random() - 0.5) * 0.01;
                this.weights[index] = initialWeight;
                this.shadowWeights[index] = initialWeight;
            }
        }

        predictFeatureWithWeights(featureX, weights) {
            let output = 0;
            let xPower = 1;

            for (let degree = 0; degree <= this.degree; degree += 1) {
                output += weights[degree] * xPower;
                xPower *= featureX;
            }

            return output;
        }

        predictWithWeights(x, weights) {
            return this.predictFeatureWithWeights(normalizeInput(x, this.normalization), weights);
        }

        predict(x) {
            return this.predictWithWeights(x, this.weights);
        }

        displayCoefficients() {
            return modelToDisplayCoefficients(this.weights, this.normalization);
        }

        applyWeights(nextWeights, syncShadowWeights = false) {
            for (let degree = 0; degree <= this.degree; degree += 1) {
                this.weights[degree] = nextWeights[degree];

                if (syncShadowWeights) {
                    this.shadowWeights[degree] = nextWeights[degree];
                }
            }
        }

        snapWeightsToIntegers() {
            this.applyWeights(roundWeights(this.weights), true);
        }

        applyDisplayWeights(displayWeights, syncShadowWeights = true) {
            this.applyWeights(displayToModelCoefficients(displayWeights, this.normalization), syncShadowWeights);
        }

        pullWeightsTowardIntegers(strength) {
            for (let degree = 0; degree <= this.degree; degree += 1) {
                const current = this.weights[degree];
                const target = Math.round(current);
                this.weights[degree] += (target - current) * strength;
                this.shadowWeights[degree] = this.weights[degree];
            }
        }

        trainEpoch(samples, learningRate, options = {}) {
            const gradients = new Float64Array(this.degree + 1);
            let loss = 0;
            const useProjectedWeights = options.integerMethod === 'project-each-epoch';
            const activeWeights = useProjectedWeights ? roundWeights(this.shadowWeights) : this.weights;

            for (const sample of samples) {
                const predicted = this.predictFeatureWithWeights(sample.featureX, activeWeights);
                const error = predicted - sample.y;
                loss += error * error;

                let xPower = 1;
                for (let degree = 0; degree <= this.degree; degree += 1) {
                    gradients[degree] += (2 / samples.length) * error * xPower;
                    xPower *= sample.featureX;
                }
            }

            if (useProjectedWeights) {
                for (let degree = 0; degree <= this.degree; degree += 1) {
                    this.shadowWeights[degree] -= learningRate * gradients[degree];
                }

                this.applyWeights(roundWeights(this.shadowWeights));
            } else if (options.integerMethod === 'annealed-bias') {
                for (let degree = 0; degree <= this.degree; degree += 1) {
                    this.weights[degree] -= learningRate * gradients[degree];
                }

                const progress = Math.max(0, Math.min(1, options.epochProgress || 0));
                const pullStrength = 0.04 + progress * 0.24;
                this.pullWeightsTowardIntegers(pullStrength);
            } else {
                for (let degree = 0; degree <= this.degree; degree += 1) {
                    this.weights[degree] -= learningRate * gradients[degree];
                    this.shadowWeights[degree] = this.weights[degree];
                }
            }

            return loss / samples.length;
        }

        coefficients(threshold = 1e-5) {
            return Array.from(this.displayCoefficients(), (value) => (Math.abs(value) < threshold ? 0 : value));
        }
    }

    window.PolynomialFinder = {
        isNearlyInteger,
        createNormalization,
        normalizeInput,
        parsePolynomialExpression,
        formatPolynomial,
        createTrainingSamples,
        roundWeights,
        modelToDisplayCoefficients,
        displayToModelCoefficients,
        solveLeastSquaresPolynomial,
        localIntegerSearch,
        bestCandidateWeights,
        meanSquaredError,
        PolynomialModel,
    };
})();