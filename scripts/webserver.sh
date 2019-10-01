#!/bin/bash
cd $2
cd ..
python $(rospack find rosweld_tools)/src/webserver.py $1&