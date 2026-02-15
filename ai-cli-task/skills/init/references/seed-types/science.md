# science:*

Covers all science subtypes: `science:physics`, `science:chemistry`, `science:biology`, `science:medicine`, `science:math`, `science:econ`.

## Subtypes

| Type | Description | Methodology |
|------|-------------|-------------|
| `science:physics` | Physics research and simulation | Dimensional analysis, conservation laws, numerical stability |
| `science:chemistry` | Chemical research, molecular modeling | Stoichiometry, thermodynamics, safety constraints |
| `science:biology` | Biological research, bioinformatics | Statistical significance, reproducibility, sequence integrity |
| `science:medicine` | Medical/pharmaceutical research | Clinical standards, dosing calculations, regulatory compliance |
| `science:math` | Mathematics, statistics, formal proofs | Proof verification, numerical precision, convergence |
| `science:econ` | Economics, quantitative finance | Econometric validation, backtesting, risk metrics |

## Phase Intelligence

### plan

- **Collection Direction**: Literature review, methodology standards, prior art, statistical frameworks
- **Key Sources**: arXiv, PubMed, Google Scholar, domain journals, reproducibility guidelines (CONSORT/PRISMA)
- **Plan Structure**: Literature review → hypothesis → methodology → experiment/simulation → analysis → conclusions
- **Key Considerations**: Reproducibility, statistical rigor, peer methodology alignment, citation of prior art, numerical validation

### verify

- **Collection Direction**: Statistical tests, reproducibility frameworks, numerical validation
- **Key Sources**: scipy.stats, R testing packages, Jupyter nbconvert --execute, numerical tolerance frameworks
- **Quick Checkpoint**: Code/simulation runs, produces output
- **Full Checkpoint**: Results reproducible (fixed seed → same output), statistical significance (p < threshold), numerical results match literature within tolerance
- **Key Tools**: `pytest`, `jupyter nbconvert --execute`, `R CMD check`, `scipy.stats`, custom reproducibility scripts

### check

- **Collection Direction**: Peer review criteria, statistical rigor standards, reproducibility requirements
- **Key Sources**: Journal submission guidelines, CONSORT/STROBE checklists, p-value/CI standards
- **Indicators**: Research, experiment, simulation, paper
- **Verification Approach**: Reproducibility verification, statistical significance, peer methodology comparison, citation validity, numerical result cross-check

### exec

- **Collection Direction**: Simulation tool reference, data analysis recipes, visualization techniques
- **Key Sources**: Tool documentation, Jupyter/R notebooks, plotting library guides (matplotlib/ggplot2)
- **Implementation Approach**: Run experiments/simulations, collect data, perform statistical analysis, write up findings
- **Step Verification**: Reproducibility verification, statistical significance, numerical cross-check against literature
