#!/bin/bash
python $(rospack find rosweld_tools)/src/app.py&

case $3 in
    nachi )
        python $(rospack find rosweld_drivers)/src/nachi_robot.py&
        python $(rospack find rosweld_drivers)/src/move_it_robot_slave.py&
	;;
    simulation )
        python $(rospack find rosweld_drivers)/src/move_it_robot.py&
	;;
esac

cd $2
cd ..
python $(rospack find rosweld_tools)/src/webserver.py $1&
