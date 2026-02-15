# chip-design

## Description

IC/FPGA/ASIC design, RTL development, verification

## Methodology

Simulation, formal verification, STA, DRC/LVS

## Phase Intelligence

### plan

- **Collection Direction**: Architecture specs, HDL coding standards, IP block documentation, process node constraints
- **Key Sources**: IEEE 1364/1800 (Verilog/SV), vendor PDKs, Synopsys/Cadence tool docs, FPGA vendor guides (Xilinx/Intel)
- **Plan Structure**: Spec/architecture → RTL design → functional simulation → synthesis → timing closure → physical design → sign-off
- **Key Considerations**: HDL coding style (Verilog/SystemVerilog/VHDL), clock domain crossing, reset strategy, lint rules (Spyglass/Ascent), coverage targets (line/toggle/FSM), PPA trade-offs (power/performance/area)

### verify

- **Collection Direction**: Simulation testbench patterns, coverage closure, formal property libraries
- **Key Sources**: UVM methodology, SVA assertion libraries, coverage-driven verification guides, EDA tool regression suites
- **Quick Checkpoint**: RTL lint clean, simulation compiles
- **Full Checkpoint**: Functional simulation all-pass, coverage targets (line ≥ 95%, toggle ≥ 90%, FSM 100%), formal properties proven, synthesis timing closure (no violations), CDC clean
- **Key Tools**: `iverilog`/`verilator` (OSS), `vcs`/`xcelium` (commercial), `yosys` (synthesis), `opensta`, `spyglass`/`ascent` (lint), `jaspergold` (formal)

### check

- **Collection Direction**: Design rule compliance, timing/power/area targets, silicon qualification criteria
- **Key Sources**: Foundry design rules, signoff criteria (DRC/LVS/ERC), automotive/mil qualification (AEC-Q100)
- **Indicators**: RTL, FPGA, ASIC, Verilog, VHDL, synthesis
- **Verification Approach**: RTL lint (Spyglass/Ascent), functional simulation (iverilog/VCS/Xcelium), code coverage (line/toggle/FSM/branch), formal verification (JasperGold/VC Formal), synthesis (Yosys/DC), STA (PrimeTime/OpenSTA), CDC analysis, DRC/LVS sign-off

### exec

- **Collection Direction**: EDA tool command reference, HDL coding recipes, IP integration guides
- **Key Sources**: Synopsys/Cadence/Mentor tool manuals, vendor IP user guides, HDL coding style guides
- **Implementation Approach**: Write RTL (Verilog/SystemVerilog/VHDL), build testbenches, run simulation (iverilog/VCS/Xcelium/Verilator), synthesize (Yosys/DC), run STA, generate netlists/bitstreams
- **Step Verification**: RTL lint pass, functional simulation pass (all testcases), code coverage targets met, synthesis timing closure (no violations), formal property proofs, CDC clean
