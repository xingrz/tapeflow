"""Entry point: ``python -m tapeflow_engine`` runs the JSON-RPC stdio loop the Electron app drives."""

from .methods import METHODS
from .rpc import serve


def main():
    serve(METHODS)


if __name__ == "__main__":
    main()
