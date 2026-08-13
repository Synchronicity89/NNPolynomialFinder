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

    function gaussianRandom() {
        let u = 0;
        let v = 0;

        while (u === 0) {
            u = Math.random();
        }

        while (v === 0) {
            v = Math.random();
        }

        return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
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
            this.firstMoments = new Float64Array(degree + 1);
            this.secondMoments = new Float64Array(degree + 1);
            this.adaptiveStepCount = 0;
            this.previousLoss = null;
            this.plateauStreak = 0;
            this.lastTrainingEvent = null;

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

        snapDisplayWeightsToIntegers() {
            this.applyDisplayWeights(roundWeights(this.displayCoefficients()), true);
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

        applyStochasticPerturbation(targetWeights, options = {}) {
            const noiseStdDev = options.noiseStdDev || 0;
            const pulseEvery = options.pulseEvery || 0;
            const pulseStdDev = options.pulseStdDev || 0;
            const plateauKickThreshold = options.plateauKickThreshold || 0;
            const plateauKickScale = options.plateauKickScale || 0;
            const maxPlateauKick = options.maxPlateauKick || 0;
            const activity = {
                noiseStdDev,
                pulseStdDev: 0,
                plateauKickStdDev: 0,
                plateauStreak: this.plateauStreak,
            };

            if (noiseStdDev > 0) {
                for (let degree = 0; degree <= this.degree; degree += 1) {
                    targetWeights[degree] += gaussianRandom() * noiseStdDev;
                }
            }

            if (pulseEvery > 0 && pulseStdDev > 0 && this.adaptiveStepCount % pulseEvery === 0) {
                activity.pulseStdDev = pulseStdDev;
                for (let degree = 0; degree <= this.degree; degree += 1) {
                    targetWeights[degree] += gaussianRandom() * pulseStdDev;
                }
            }

            if (plateauKickThreshold > 0 && this.plateauStreak >= plateauKickThreshold && plateauKickScale > 0) {
                const plateauPower = Math.min((this.plateauStreak - plateauKickThreshold + 1) * plateauKickScale, maxPlateauKick || plateauKickScale);
                activity.plateauKickStdDev = plateauPower;

                for (let degree = 0; degree <= this.degree; degree += 1) {
                    targetWeights[degree] += gaussianRandom() * plateauPower;
                }
            }

            return activity;
        }

        trainingProfileOptions(trainingProfile, meanLoss, epochProgress = 0) {
            const progress = Math.max(0, Math.min(1, epochProgress));

            if (trainingProfile === 'adaptive-rms-simplicity') {
                return {
                    beta1: 0.9,
                    beta2: 0.999,
                    weightDecay: 0.00015,
                    simplicityBias: 0.0015,
                    learningRateScale: 1,
                    gradientClip: 8,
                    noiseStdDev: 0,
                };
            }

            if (trainingProfile === 'adaptive-rms-aggressive') {
                const scheduledBoost = progress < 0.45
                    ? 2.25 - progress * 2.2
                    : progress < 0.85
                        ? 1.35
                        : 1.1;
                const plateauBoost = this.plateauStreak > 0 ? Math.min(1 + this.plateauStreak * 0.12, 1.75) : 1;
                const lossBoost = meanLoss > 1 ? 1.2 : meanLoss > 0.05 ? 1.08 : 1;

                return {
                    beta1: 0.82,
                    beta2: 0.985,
                    weightDecay: 0,
                    simplicityBias: 0,
                    learningRateScale: scheduledBoost * plateauBoost * lossBoost,
                    gradientClip: 12,
                    noiseStdDev: 0,
                };
            }

            if (trainingProfile === 'adaptive-rms-annealed-noise') {
                return {
                    beta1: 0.88,
                    beta2: 0.995,
                    weightDecay: 0.00002,
                    simplicityBias: 0,
                    learningRateScale: 1.15,
                    gradientClip: 10,
                    noiseStdDev: 0.035 * (1 - progress) + 0.0025,
                };
            }

            if (trainingProfile === 'adaptive-rms-pulse-kicks') {
                return {
                    beta1: 0.86,
                    beta2: 0.992,
                    weightDecay: 0.00002,
                    simplicityBias: 0,
                    learningRateScale: 1.18,
                    gradientClip: 10,
                    noiseStdDev: 0.004,
                    pulseEvery: 28,
                    pulseStdDev: 0.08 * (1 - progress * 0.6),
                };
            }

            if (trainingProfile === 'adaptive-rms-plateau-escape') {
                const lossScale = meanLoss > 0.5 ? 1.2 : meanLoss > 0.05 ? 1.05 : 1;
                return {
                    beta1: 0.84,
                    beta2: 0.99,
                    weightDecay: 0.00001,
                    simplicityBias: 0,
                    learningRateScale: 1.2 * lossScale,
                    gradientClip: 11,
                    noiseStdDev: 0.0015,
                    plateauKickThreshold: 10,
                    plateauKickScale: 0.01,
                    maxPlateauKick: 0.16,
                };
            }

            return {
                beta1: 0.9,
                beta2: 0.999,
                weightDecay: 0.00005,
                simplicityBias: 0,
                learningRateScale: 1,
                gradientClip: 8,
                noiseStdDev: 0,
            };
        }

        applyAdaptiveGradients(gradients, learningRate, options = {}) {
            const beta1 = options.beta1 || 0.9;
            const beta2 = options.beta2 || 0.999;
            const epsilon = options.epsilon || 1e-8;
            const weightDecay = options.weightDecay || 0;
            const simplicityBias = options.simplicityBias || 0;
            const gradientClip = options.gradientClip || 0;
            const learningRateScale = options.learningRateScale || 1;
            const applyToShadowWeights = options.applyToShadowWeights || false;
            const progress = Math.max(0, Math.min(1, options.epochProgress || 0));
            const decayRamp = 1 - progress * 0.35;
            const targetWeights = applyToShadowWeights ? this.shadowWeights : this.weights;
            const effectiveLearningRate = learningRate * learningRateScale;

            this.adaptiveStepCount += 1;
            const biasCorrection1 = 1 - Math.pow(beta1, this.adaptiveStepCount);
            const biasCorrection2 = 1 - Math.pow(beta2, this.adaptiveStepCount);

            for (let degree = 0; degree <= this.degree; degree += 1) {
                const degreeScale = this.degree <= 0 ? 0 : degree / this.degree;
                let gradient = gradients[degree] + targetWeights[degree] * weightDecay;

                if (simplicityBias > 0 && degree > 1) {
                    gradient += targetWeights[degree] * simplicityBias * degreeScale * decayRamp;
                }

                if (gradientClip > 0) {
                    gradient = Math.max(-gradientClip, Math.min(gradientClip, gradient));
                }

                this.firstMoments[degree] = beta1 * this.firstMoments[degree] + (1 - beta1) * gradient;
                this.secondMoments[degree] = beta2 * this.secondMoments[degree] + (1 - beta2) * gradient * gradient;

                const correctedFirstMoment = this.firstMoments[degree] / biasCorrection1;
                const correctedSecondMoment = this.secondMoments[degree] / biasCorrection2;
                targetWeights[degree] -= effectiveLearningRate * correctedFirstMoment / (Math.sqrt(correctedSecondMoment) + epsilon);
            }

            const stochasticActivity = this.applyStochasticPerturbation(targetWeights, options);

            if (applyToShadowWeights) {
                this.applyWeights(roundWeights(this.shadowWeights));
                return stochasticActivity;
            }

            for (let degree = 0; degree <= this.degree; degree += 1) {
                this.shadowWeights[degree] = this.weights[degree];
            }

            return stochasticActivity;
        }

        trainEpoch(samples, learningRate, options = {}) {
            const gradients = new Float64Array(this.degree + 1);
            let loss = 0;
            const useProjectedWeights = options.integerMethod === 'project-each-epoch';
            const strictIntegerWeights = options.strictIntegerWeights === true;
            const activeWeights = useProjectedWeights ? roundWeights(this.shadowWeights) : this.weights;
            const trainingProfile = options.trainingProfile || 'standard-sgd';
            let stochasticActivity = null;

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

            const meanLoss = loss / samples.length;

            if (this.previousLoss !== null) {
                this.plateauStreak = meanLoss > this.previousLoss * 0.995 ? this.plateauStreak + 1 : 0;
            }

            const adaptiveOptions = trainingProfile === 'standard-sgd'
                ? null
                : this.trainingProfileOptions(trainingProfile, meanLoss, options.epochProgress || 0);

            if (useProjectedWeights) {
                if (adaptiveOptions) {
                    stochasticActivity = this.applyAdaptiveGradients(gradients, learningRate, {
                        applyToShadowWeights: true,
                        epochProgress: options.epochProgress,
                        ...adaptiveOptions,
                    });
                } else {
                    for (let degree = 0; degree <= this.degree; degree += 1) {
                        this.shadowWeights[degree] -= learningRate * gradients[degree];
                    }

                    this.applyWeights(roundWeights(this.shadowWeights));
                }
            } else if (options.integerMethod === 'annealed-bias') {
                if (adaptiveOptions) {
                    stochasticActivity = this.applyAdaptiveGradients(gradients, learningRate, {
                        epochProgress: options.epochProgress,
                        ...adaptiveOptions,
                    });
                } else {
                    for (let degree = 0; degree <= this.degree; degree += 1) {
                        this.weights[degree] -= learningRate * gradients[degree];
                    }
                }

                const progress = Math.max(0, Math.min(1, options.epochProgress || 0));
                const pullStrength = 0.04 + progress * 0.24;
                this.pullWeightsTowardIntegers(pullStrength);
            } else {
                if (adaptiveOptions) {
                    stochasticActivity = this.applyAdaptiveGradients(gradients, learningRate, {
                        epochProgress: options.epochProgress,
                        ...adaptiveOptions,
                    });
                } else {
                    for (let degree = 0; degree <= this.degree; degree += 1) {
                        this.weights[degree] -= learningRate * gradients[degree];
                        this.shadowWeights[degree] = this.weights[degree];
                    }
                }
            }

            if (strictIntegerWeights) {
                this.snapDisplayWeightsToIntegers();
            }

            this.lastTrainingEvent = stochasticActivity;
            this.previousLoss = meanLoss;
            return meanLoss;
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