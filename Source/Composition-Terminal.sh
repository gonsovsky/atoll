#!/bin/bash
DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
exec /bin/bash --rcfile "$DIR/Tools/bashrc"
