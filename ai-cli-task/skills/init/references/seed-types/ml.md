# ml

## Description

Machine learning, model training, datasets

## Methodology

Accuracy/F1, cross-validation, data split integrity

## Phase Intelligence

### plan

- **Collection Direction**: Model architecture options, dataset preparation strategies, training methodologies, SOTA benchmarks
- **Key Sources**: arXiv papers, HuggingFace model cards, Papers With Code leaderboards, framework docs (PyTorch/TF)
- **Plan Structure**: Data preparation → model architecture → training strategy → evaluation metrics
- **Key Considerations**: Dataset splits, baseline benchmarks, metric thresholds (accuracy/F1/loss), reproducibility

### verify

- **Collection Direction**: Model evaluation metrics, fairness testing, robustness testing
- **Key Sources**: sklearn.metrics, Fairlearn, ART (adversarial robustness), MLflow evaluation
- **Quick Checkpoint**: Training script runs, model loads
- **Full Checkpoint**: Accuracy/F1/loss meet baseline, cross-validation stable, data distribution check, inference latency ≤ SLA
- **Key Tools**: `pytest`, `mlflow`, `tensorboard`, `sklearn.metrics`, `torch.testing`, custom benchmark scripts

### check

- **Collection Direction**: Model performance baselines, fairness criteria, deployment readiness
- **Key Sources**: MLOps maturity model, responsible AI frameworks, model card standards
- **Indicators**: Model, training, accuracy, dataset
- **Verification Approach**: Metric benchmarks (accuracy/F1/loss), cross-validation, data distribution checks

### exec

- **Collection Direction**: Framework API reference, training recipes, hyperparameter tuning guides
- **Key Sources**: PyTorch/TF tutorials, HuggingFace Trainer docs, Optuna/Ray Tune guides
- **Implementation Approach**: Prepare datasets, run training scripts, evaluate metrics
- **Step Verification**: Metric benchmarks against baseline, data distribution checks
