# dsp

## Description

Digital signal processing, audio, frequency analysis

## Methodology

SNR, THD, spectral analysis, listening tests

## Phase Intelligence

### plan

- **Collection Direction**: Algorithm selection, filter design theory, sampling constraints, numerical stability
- **Key Sources**: DSP textbooks (Oppenheim, Proakis), scipy.signal docs, MATLAB references, IEEE signal processing
- **Plan Structure**: Signal flow → algorithm selection → parameter tuning → measurement
- **Key Considerations**: Sample rates, frequency response specs, SNR requirements, golden reference signals

### verify

- **Collection Direction**: Signal analysis tools, measurement automation, golden reference comparison
- **Key Sources**: sox, scipy.signal testing, Audio Precision docs, PESQ/POLQA standards
- **Quick Checkpoint**: Build/compile pass, signal generation runs
- **Full Checkpoint**: SNR ≥ threshold, frequency response within tolerance, THD ≤ limit, golden reference correlation ≥ 0.99
- **Key Tools**: `scipy.signal`, `sox --stats`, `octave`, `numpy.fft`, `audacity` (CLI export)

### check

- **Collection Direction**: Signal quality standards, regulatory compliance, performance benchmarks
- **Key Sources**: ITU-T standards, FCC emission limits, audio codec quality benchmarks (MUSHRA)
- **Indicators**: Audio, FFT, filter, spectrum, waveform
- **Verification Approach**: SNR measurement, frequency response verification, golden reference comparison

### exec

- **Collection Direction**: Algorithm implementation guides, numerical recipes, library API reference
- **Key Sources**: scipy/numpy API, MATLAB function reference, DSP implementation cookbooks
- **Implementation Approach**: Run signal processing tools (scipy, sox, MATLAB/Octave, etc.), generate/measure signals
- **Step Verification**: SNR measurement, frequency response verification, golden reference comparison
