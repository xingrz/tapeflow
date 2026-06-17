"""PyInstaller entry point for the frozen one-shot CLI.

Runs ``tapeflow_engine.cli`` (the same `capabilities` / `analyze` / `build` front-end as the
`tapeflow` console script) as a standalone binary, frozen into the *same* onedir bundle as the
`tapeflow-engine` sidecar so the two share one Python runtime. The desktop app ships both, so an
installed TapeFlow doubles as the CLI for scripts and agents — no Python install. The merge engines
(hdvmerge, dvmerge) are frozen in by the spec's hidden imports.
"""

from tapeflow_engine.cli import main

if __name__ == "__main__":
    main()
