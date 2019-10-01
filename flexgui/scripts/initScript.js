if (!String.prototype.format) {
    String.prototype.format = function() {
        var args = arguments;
        return this.replace(/{(\d+)}/g, function(match, number) {
            return typeof args[number] != 'undefined' ?
                args[number] :
                match;
        });
    };
}

if (!Array.prototype.find){
	Array.prototype.find = function (predicate, thisValue) {
        var arr = Object(this);
        if (typeof predicate !== 'function') {
            throw new TypeError();
        }
        for(var i=0; i < arr.length; i++) {
            if (i in arr) {  // skip holes
                var elem = arr[i];
                if (predicate.call(thisValue, elem, i, arr)) {
                    return elem;  // (1)
                }
            }
        }
        return undefined;  // (2)
    }
}

//current x,y,z for the selected calibration point
x = 0;
y = 0;
z = 0;

//modification steps and possible values
dangle = '0.5°';
vangle = '0.01°,0.1°,0.5°,1°,2°,5°';

doffset = '0.01m';
voffset = '0.001m,0.005m,0.01m,0.05m,0.1m';

//project specific data
project_data = {
    //private current step
    _step: 0,
    //private current speed
    _speed: 1,
    //path input HTML
    path_input_html: "<input type='text' style='width: 200px; height: 30px'/>",
    //decompressed plan object from the backend
    plan: null,
    //lock the values on the UI while the backend is updating
    locks: {
        step: false,
        modification: false,
        bead: false,
        speed: false,
        beadindex: false
    },
    //current modification
    modification: {

    },
    //default settings from the backend
    defaultSettings: {

    },
    //current values of the welding params on every step
    currentValues: [],
    //get the current value on the selected step
    get currentValue() {
        return getValueAt(project_data.step);
    },
    //default modification properties
    defaultModProps: {
        'y': {
            value: 0,
            unit: 'm',
            label: 'Y offset',
            groupid: 1,
            inversed: true,
            axis: true
        },
        'z': {
            value: 0,
            unit: 'm',
            label: 'Z offset',
            groupid: 1,
            inversed: true,
            axis: true
        },
        'angle': {
            value: 0,
            unit: '°',
            label: 'Angle',
            groupid: 2,
            axis: true
        },
        'amperage': {
            value: 0,
            unit: 'A',
            label: 'Amperage',
            groupid: 3,
            min: 50,
            max: 400,
            axis: true
        },
        'voltage': {
            value: 0,
            unit: 'V',
            label: 'Voltage',
            groupid: 4,
            min: 8,
            max: 20,
            axis: true
        },
        'filler_speed': {
            value: 0,
            unit: 'cm/min',
            label: 'Filler speed',
            groupid: 5,
            min: 0,
            max: 300,
            axis: true
        },
        'delta_r': {
            value: 0,
            unit: '°',
            label: 'Delta r',
            groupid: 2,
            axis: true
        },
        'speed': {
            value: 0,
            label: 'Torch speed',
            min: 0,
            max: 30,
            unit: 'cm/min',
            axis: false
        }
    },
    //watchers on the screen to remove when redirection from the screen
    currentScreenWatchers: [],
    //camera fidget default settings	
    camera: {
        url: 'http://{0}:8080/stream?topic=/camera_image1'.format($rootScope.device.ip),
        enabled: false
    },
    //file server path
    fileServer: 'http://{0}/'.format($rootScope.device.ip),
    //3D fidget default settings
    threeD: {
        url: 'http://{0}/'.format($rootScope.device.ip),
        markers: '/rosweld/calibration_markers,/rosweld/current_path',
        fixed_frame: '/world'
    },
    get speed() {
        return project_data._speed;
    },
    set speed(v) {
        project_data.locks.speed = true;

        if (project_data.speedLockTimer) {
            window.clearTimeout(project_data.speedLockTimer);
            delete project_data.speedLockTimer;
        }

        project_data.speedLockTimer = window.setTimeout(function() {
            project_data.locks.speed = false
        }, 500);
        project_data._speed = v;

        #callService('rosweld', 'project_control', {
            command: 'input',
            json: JSON.stringify({
                value: project_data._speed,
                param: 'speed'
            })
        }, function(result) {});
    },
    get step() {
        return Math.max(0, project_data._step);
    },
    set step(v) {
        project_data.locks.step = true;

        if (project_data.unlockTimer) {
            window.clearTimeout(project_data.unlockTimer);
            delete project_data.unlockTimer;
        }

        project_data.unlockTimer = window.setTimeout(function() {
            project_data.locks.step = false
        }, 500);
        project_data._step = v;

        setCurrentModification();

        #callService('rosweld', 'project_control', {
            command: 'input',
            json: JSON.stringify({
                value: {
                    step: v
                },
                param: 'step'
            })
        }, function(result) {});
    },
    //beads list
    beads: {
        //define a list with the name of the beads
        get list() {
            if (project_data.plan && project_data.plan.current_task && project_data.plan.current_task.path.beads) {
                return project_data.plan.current_task.path.beads.map(function(b, i) { return ("Bead nr. {0}").format(i); });
            }

            return [];
        },
        //property to easy access the current bead
        get current() {
            if (project_data.plan &&
                project_data.plan.current_task &&
                project_data.plan.current_task.path.beads &&
                project_data.plan.current_task.path.beads.length > project_data.plan.current_task.current_bead_index) {

                return project_data.plan.current_task.path.beads[project_data.plan.current_task.current_bead_index];
            }

            return null;
        },
        //property to easy access the current bead index
        get currentIndex() {
            return project_data.beads.list[project_data._bead_index];
        },
        set currentIndex(v) {
            v = parseInt(decodeURI(v).match(/\d+$/)[0], 10);

            project_data.locks.beadindex = true;

            if (project_data.beadindex_unlockTimer) {
                window.clearTimeout(project_data.beadindex_unlockTimer);
                delete project_data.beadindex_unlockTimer;
            }

            project_data.beadindex_unlockTimer = window.setTimeout(function() {
                project_data.locks.beadindex = false
            }, 500);
            project_data._bead_index = v;

            setCurrentModification();

            #callService('rosweld', 'project_control', {
                command: 'input',
                json: JSON.stringify({
                    value: v,
                    param: 'select_bead'
                })
            }, function(result) {});
        },
        //current welding properties, such as offset and angle
        currentProperties: {

        }
    },
    WPS: {
		get currentJob() {
			if (!@weld_settings || 
				!@weld_settings.value || 
				!@weld_settings.value.configurations ||
				!Array.isArray(@weld_settings.value.configurations)) return;

            var job = @weld_settings.value.configurations.find(function(element) {
                return element.job_number == project_data.WPS.currentIdx;
            });

            return job;
        },
        get changed() {
            var changed = false;
            var remote_values = project_data.WPS.currentJob;
            var current_values = project_data.WPS.values;

            if (!remote_values) return changed;

            Object.keys(remote_values).forEach(function(p) {
                if (parseFloat(current_values[p]).toFixed(2) != parseFloat(remote_values[p]).toFixed(2))
                    changed = true;
            });

            return changed;
        },
        get selectedMode() {
            return project_data.WPS.modes[project_data.WPS.values._mode];
        },
        set selectedMode(v) {
            project_data.WPS.values._mode = project_data.WPS.modes.indexOf(v);
        },
        get modes() {
            return ['DC', 'AC'];
        },
        jobsVisible: true,
        currentIdx: -1,
        configurations: {},
        autoUpdate: false,
        _currentJob: {},
        limits: {
            filler_speed: {
                min: 1,
                max: 100,
                unit: 'cm/s'
            },
            voltage: {
                min: 1,
                max: 50,
                unit: 'V'
            },
            amperage: {
                min: 1,
                max: 300,
                unit: 'A'
            }
        },
        jobSelector: {
            get list() {
                return Object.keys(project_data.WPS.configurations).map(function(key) {
                    return "JOB " + key;
                }).join(",");
            },
            get selected() {
                return "JOB " + project_data.WPS.currentIdx;
            },
            set selected(v) {
                idx = decodeURI(v).substring(4);
                project_data.WPS.currentIdx = idx;
                project_data.WPS.functions.init(idx);
            },
            get selectedJob() {
                return "JOB " + project_data.beads.currentProperties.job_number;
            },
            set selectedJob(v) {
                idx = decodeURI(v).substring(4);
                project_data.beads.currentProperties.job_number = idx;
            }
        },
        functions: {
            save: function() {
				values = {};
                Object.keys(project_data.WPS.values).forEach(function(k) {
                    values[k.substring(1)] = project_data.WPS.values[k]
                });

                #callService('welding_driver', 'edit_config', {
                    config: values
                }, function(result) {
					if (!@weld_settings || !@weld_settings.value) return;
					
                    if (!@weld_settings.value.auto_update) {
                        bootbox.alert("You have to update the values on the WPS manually!");
                    }

                    $rootScope.$apply();
                });
            },
            restore: function() {
                project_data.WPS.functions.init();
            },
            init: function(idx, apply) {
                wps = project_data.WPS;
                wps.configurations = {};
				
				if (!@weld_settings || !@weld_settings.value) return;

                if (idx === undefined) {
                    idx = @weld_settings.value.current_index;
                }

                wps.currentIdx = idx;
                @weld_settings.value.configurations.forEach(function(cfg) {
                    wps.configurations[cfg.job_number] = angular.copy(cfg);
                });

                wps.values = angular.copy(wps.currentJob);

                if (apply) {
                    $rootScope.$apply();
                }
            }
        }
    }
};

//adding the default properties at the 0 step
project_data.currentValues[0] = angular.copy(project_data.defaultModProps);

//convert calibration data to a HTML table
convert_calibration_data = function() {
    var data = [];
    angular.forEach(@points, function(p, i) {
        var rp = p.measured.position;
        var mp = p.model;
        data.push("<tr class='{6}'><td>{0}</td><td>{1}</td><td>{2}</td><td>{3}</td><td>{4}</td><td>{5}</td></tr>".format(mp.x.toFixed(3), mp.y.toFixed(3), mp.z.toFixed(3), rp.x.toFixed(3), rp.y.toFixed(3), rp.z.toFixed(3), i == @selected_point ? 'selected' : ''));
    });
    var table = "<table class='calibration_points'>\
                    <thead>\
                        <tr><th colspan='3'>Model</th><th colspan='3'>Robot</th></tr>\
                        <tr><th>X</th><th>Y</th><th>Z</th><th>X</th><th>Y</th><th>Z</th></tr>{0}\
                </table>".format(data.join(''));
    return table;
};

//set click for a calibration point
//cals a ROS service on the backend to change 
//the selected point
setClickForCalibrationPoints = function() {
    $(".calibration_points tr").unbind("click").click(function() {
        var idx = $(this).index() - 2;
        #callService('rosweld', 'set_calibration', {
            command: "set_selected_point",
            json: JSON.stringify({
                index: idx
            })
        }, function(result) {
            var act = @points[idx].model;
            x = act.x;
            y = act.y;
            z = act.z;
        });
    });
};

//update or create a modification
publishModification = function() {
    mod = project_data.modification;
    value = {};

    Object.keys(getModificationProperties()).forEach(function(p) {
        value[p] = mod["_" + p];
    });

    json = JSON.stringify({
        value: value,
        param: 'modification'
    });
    #callService('rosweld', 'project_control', {
        command: 'input',
        json: json
    }, function(result) {

    });
};

//change bead settings
publishBeadSettings = function() {
    b = project_data.beads.currentProperties;
    value = {};

    Object.keys(beadProperties).forEach(function(p) {
        value[p] = b["_" + p];
    });

    json = JSON.stringify({
        value: value,
        param: 'setup_bead'
    });
	
    #callService('rosweld', 'project_control', {
        command: 'input',
        json: json
    }, function(result) {});
};

//get the current modification properties from the plan
getModificationProperties = function(i) {
    //check for default values
    if (typeof i == 'undefined' && typeof project_data.step == 'undefined') {
        return project_data.defaultModProps;
    } else if (typeof i == 'undefined') {
        i = project_data.step;
    }

    //use step as a string
    i = i.toString();

    //return default properties if there is any modification on the step
    if (project_data.plan === null || project_data.plan.current_task === null || !project_data.beads.current || !project_data.beads.current.planned_modifications[i]) {
        return project_data.defaultModProps;
    }

    //convert welding params and offset from the plan
    //to JS objects
    wp = getWeldParams(project_data.beads.current.planned_modifications[i]);
    off = getOffset(project_data.beads.current.planned_modifications[i]);

    return {
        'y': {
            value: off.y,
            unit: 'm'
        },
        'z': {
            value: off.z,
            unit: 'm'
        },
        'angle': {
            value: project_data.beads.current.planned_modifications[i].angle,
            unit: '°'
        },
        'amperage': {
            value: wp.amperage,
            unit: 'A'
        },
        'voltage': {
            value: wp.voltage,
            unit: 'V'
        },
        'filler_speed': {
            value: wp.filler_speed,
            unit: 'cm/min'
        },
        'delta_r': {
            value: project_data.beads.current.planned_modifications[i].delta_r,
            unit: '°'
        }
    };
};

//get current bead properties
getBeadProperties = function() {

    //return zeros if nothing selected / not existing
    if (!project_data.plan || !project_data.plan.current_task || !project_data.beads.current) {
        return {
            y: 0,
            z: 0,
            angle: 0,
            job_number: 0
        };
    } else {

        off = getOffset(project_data.beads.current);

        return {
            'y': off.y,
            'z': off.z,
            'angle': project_data.beads.current.angle,
            'job_number': project_data.beads.current.wps_job_number,
        };
    }
};

//get current welding parameters from an object
getWeldParams = function(obj) {
    //if it is not a python object
    if (!obj.welding_parameters) {
        return {
            amperage: 0,
            voltage: 0,
            filler_speed: 0
        };
    }

    return {
        amperage: obj.welding_parameters.amperage,
        voltage: obj.welding_parameters.voltage,
        filler_speed: obj.welding_parameters.filler_speed
    };
};

//set current modification
setCurrentModification = function() {
    var idx = project_data.beads.current ? Object.keys(project_data.beads.current.planned_modifications) : [];
    var dict = getModificationProperties(project_data.step);
    var def = false;

    if (idx.indexOf(project_data.step.toString()) == -1) {
        def = true;
        Object.keys(dict).forEach(function(p) {
            project_data.modification["_" + p] = project_data.defaultModProps[p].value;
        });
    } else {
        Object.keys(dict).forEach(function(p) {
            project_data.modification["_" + p] = dict[p].value;
        });
    }
};

//get offset from object
getOffset = function(obj) {
    //if the object is not a python object
    if (!obj.offset) {
        return {
            x: 0,
            y: 0,
            z: 0
        };
    }

    return {
        x: obj.offset.x,
        y: obj.offset.y,
        z: obj.offset.z,
    };
};

//setup getter and setter for the bead properties
Object.keys(getBeadProperties()).forEach(function(p) {
    project_data.beads.currentProperties['_' + p] = 0;

    Object.defineProperty(project_data.beads.currentProperties, p, {
        get() {
            return project_data.beads.currentProperties["_" + p]
        },
        set(v) {
            project_data.locks.bead = true;
            if (project_data.unlockBeadTimer) {
                window.clearTimeout(project_data.unlockBeadTimer);
                delete project_data.unlockBeadTimer;
            }

            project_data.unlockBeadTimer = window.setTimeout(function() {
                project_data.locks.bead = false
            }, 500);
            project_data.beads.currentProperties["_" + p] = v;
            publishBeadSettings();
        },
        enumerable: true,
        configurable: true
    });
});

//setup getter and setter for the modification properties
Object.keys(getModificationProperties()).forEach(function(p) {
    project_data.modification['_' + p] = project_data.defaultModProps[p].value;

    Object.defineProperty(project_data.modification, p, {
        get() {
            return project_data.modification["_" + p];
        },
        set(v) {
            project_data.locks.modification = true;

            if (project_data.unlockModTimer) {
                window.clearTimeout(project_data.unlockModTimer);
                delete project_data.unlockModTimer;
            }

            project_data.unlockModTimer = window.setTimeout(function() {
                project_data.locks.modification = false
            }, 500);
            project_data.modification["_" + p] = v;
            publishModification();
        },
        enumerable: true,
        configurable: true
    });
});

loadCurrentValues = function() {
    var steps = [];
    var last = angular.copy(project_data.defaultModProps);

    //load the global defaults
    Object.keys(project_data.defaultSettings).forEach(function(p) {
        last[p].value = project_data.defaultSettings[p];
    });

    if (project_data.WPS.configurations[project_data.beads.currentProperties.job_number])
        //overwrite the value with the job's start value
        Object.keys(project_data.WPS.configurations[project_data.beads.currentProperties.job_number]).forEach(function(p) {
            if (last[p.substring(1)]) {
                last[p.substring(1)].value = project_data.WPS.configurations[project_data.beads.currentProperties.job_number][p];
            }
        });

    //return if no steps
    if (!project_data.plan.current_task.path.points) return steps;

    //go through the path
    for (var i = 0; i < project_data.plan.current_task.path.points.length; i++) {
        var currentMod = getModificationProperties(i);

        Object.keys(currentMod).forEach(function(p) {
            last[p].value += currentMod[p].value;
        });

        steps.push(angular.copy(last));
    }

    return steps;
};

//load plan from the topic
loadPlan = function() {

	try{
		project_data.plan = JSON.parse(@plan);
		project_data.plan.current_task = project_data.plan.tasks[project_data.plan.current_task_idx];
	} catch (e){
		console.log("Error loading plan", @plan)
		#message("Can not load plan", #warningMessage);
		return
	}
    //update values if they are not locked 
    if (!project_data.locks.step) {
        project_data._step = project_data.plan.current_task.step;
    }

    if (!project_data.locks.modification) {
        setCurrentModification();
    }

    if (!project_data.locks.speed) {
        project_data._speed = project_data.plan.current_task.speed;
    }

    if (!project_data.locks.beadindex) {
        project_data._bead_index = project_data.plan.current_task.current_bead_index;
    }

    if (!project_data.locks.bead) {
        beadProperties = getBeadProperties();

        Object.keys(beadProperties).forEach(function(p) {
            try {
                project_data.beads.currentProperties["_" + p] = beadProperties[p];
            } catch (e) {
                project_data.beads.currentProperties["_" + p] = 0;
            }
        });
    }

    //load current values for each step
    project_data.currentValues = loadCurrentValues();
};

loadFileAsText = function() {
    var fileToLoad = document.getElementById("pathinput").files[0];

    var fileReader = new FileReader();
    fileReader.onload = function(fileLoadedEvent) {
        var textFromFileLoaded = fileLoadedEvent.target.result;

        #callService('rosweld', 'project_control', {
            command: 'input',
            json: JSON.stringify({
                value: textFromFileLoaded,
                param: 'path'
            })
        }, function(result) {

        });
    };

    fileReader.readAsText(fileToLoad, "UTF-8");
};

//create parameter chart
addParameterChart = function() {

    //set default chart color
    Chart.defaults.global.defaultFontColor = "#fff";

    //setup chart colors
    window.chartColors = {
        red: 'rgb(255, 99, 132)',
        orange: 'rgb(255, 159, 64)',
        yellow: 'rgb(255, 205, 86)',
        green: 'rgb(75, 192, 192)',
        blue: 'rgb(54, 162, 235)',
        purple: 'rgb(153, 102, 255)',
        grey: 'rgb(231,233,237)'
    };

    //properties to use
    var props = project_data.defaultModProps;

    //get the chart's data
    function getData() {
        //datasets
        var datasets = [];
        //y axis (groups)
        var yaxis = [];

        Object.keys(props).forEach(function(p, idx) {
            if (props[p].axis === true) {
                //create yxais name 
                var gid = 'y-axis-' + props[p].groupid;

                //create dataset
                var set = {
                    label: props[p].label + " (" + props[p].unit + ")",
                    steppedLine: true,
                    borderColor: window.chartColors[Object.keys(window.chartColors)[idx]],
                    fill: false,
                    hidden: localStorage.getItem("dataset_" + datasets.length) == "true",
                    data: project_data.currentValues.map(function(v) { return v[p].value }),
                    yAxisID: gid
                };

                //add new axis if not existing
                if (yaxis.map(function(v){ return v.id; }).indexOf(gid) == -1) {
                    var axis = {
                        type: 'linear',
                        display: true,
                        position: yaxis.length % 2 === 0 ? 'left' : 'right',
                        id: gid,
                        ticks: {
                            reverse: props[p].inversed
                        },
                        gridLines: {
                            drawOnChartArea: yaxis.length === 0,
                        },
                        scaleLabel: {
                            display: true,
                            labelString: props[p].unit
                        }
                    };
                    yaxis.push(axis);
                }

                //add new dataset
                datasets.push(set);
            }
        });

        for (var yi = 0; yi < yaxis.length; yi++) {
            axis = yaxis[yi];
            found = datasets.find(function(e) {
                return e.hidden === false && e.yAxisID == axis.id
            });
            if (!found) {
                axis.display = false;
            } else {
                axis.display = true;
            }
        }

        //return with the dataset, axis and labels
        return {
            datasets: datasets,
            yaxis: yaxis,
            labels: project_data.currentValues.map(function(v, i){ return i.toString() })
        };
    }

    //create chart config object
    function createConfig(data) {
        return {
            type: 'line',
            data: {
                labels: data.labels,
                datasets: data.datasets
            },
            options: {
                animation: false,
                maintainAspectRatio: false,
                responsive: true,
                scaleFontColor: "#FFFFFF",
                title: {
                    display: false
                },
                legend: {
                    display: false
                },
                scales: {
                    yAxes: data.yaxis
                },
                tooltips: {
                    mode: 'index',
                    intersect: true
                },
                onClick: function(evt) {
                    var activePoints = project_data.chart.getElementsAtEvent(evt);
                    var firstPoint = activePoints[0];

                    if (!_firstPoint) return;

                    project_data.step = firstPoint._index;
                }
            }
        };
    }

    //add chart
    function createChart() {
        project_data.currentScreenWatchers.push($rootScope.$watch(function() {
            return project_data.currentValues;
        }, function(nv) {
            var data = getData(nv);

            if (!project_data.chart) {
                $(".chart-container").remove();
                var container = document.querySelector('.chartContainer > div');

                var div = document.createElement('div');
                div.classList.add('chart-container');

                var canvas = document.createElement('canvas');
                div.appendChild(canvas);
                container.appendChild(div);

                var ctx = canvas.getContext('2d');
                var config = createConfig(data);
                project_data.chart = new Chart(ctx, config);
            } else {
                var needUpdate = false;
                if (project_data.chart.data.labels.length != data.labels.length) {
                    project_data.chart.data.labels = data.labels;
                    needUpdate = true;
                }

                data.datasets.forEach(function(ds, idx){
                    _ds = project_data.chart.data.datasets[idx];
                    if (ds.data.length != _ds.data.length) {
                        project_data.chart.data.datasets[idx].data = ds.data;
                        needUpdate = true;
                    } else {
                        ds.data.forEach(function(d, idx) {
                            if (_ds.data[idx] != d) {
                                _ds.data[idx] = d;
                                needUpdate = true;
                            }
                        });
                    }
                });

                if (needUpdate) project_data.chart.update();
            }
        }));
    }

    if (Chart) {
        createChart();
    } else {
        //download chartjs javascript files if not loaded 
        $.when(
                $.getScript(project_data.fileServer + "rosweld_tools_examples/flexgui/scripts/utils.js"),
                $('<link/>', {
                    rel: 'stylesheet',
                    type: 'text/css',
                    href: project_data.fileServer + "rosweld_tools_examples/flexgui/scripts/chart.css"
                }).appendTo('head'),
                $.Deferred(function(deferred) {
                    $(deferred.resolve);
                }),
                $.getScript(project_data.fileServer + "rosweld_tools_examples/flexgui/scripts/Chart.bundle.js"))
            .done(function() {
                createChart();
            });
    }
};

//add cam upload input
addCAMUploader = function() {
    var inputHtml = '<input type="file" name="file" id="pathinput" name="pathinput" accept=".wmcam" class="inputfile" /><label for="pathinput"><span  class="glyphicon glyphicon-floppy-open"></span</label>';

    $(".pathinput > div").append(inputHtml);
    $("#pathinput").change(function() {

        bootbox.confirm('Do you really want to load the selected CAM file?', function(r) {
            if (r) {
                loadFileAsText();
            }
        });

    });
};

//draw a ruler 
drawMeters = function(properties, limits) {
    limits = limits || project_data.defaultModProps;

    properties.forEach(function(nm) {
        var container = document.querySelector("." + nm + "Meter > div");
        var meterFidget = $rootScope.project.getFidgetByName(nm + "Meter");

        $(".meter_" + nm).remove();
        var div = document.createElement('div');
        div.classList.add('meter');

        var canvas = document.createElement('canvas');
        div.appendChild(canvas);
        container.appendChild(div);

        var ctx = canvas.getContext('2d');
        var w = meterFidget.properties.width,
            h = meterFidget.properties.height;
        ctx.strokeStyle = "#FFFFFF";
        ctx.canvas.width = w;
        ctx.canvas.height = h;
        ctx.beginPath();
        ctx.moveTo(w - 5, 10);
        ctx.lineTo(w - 5, h - 10);
        ctx.fillStyle = '#ff5400';
        ctx.stroke();
        ctx.font = "14px Arial";

        for (var i = 0; i <= 5; i++) {
            ctx.beginPath();
            var _h = 10 + (h - 20) / 5 * i;
            ctx.moveTo(w - 5, _h);
            ctx.lineTo(w - 25, _h);
            ctx.stroke();
            var l = limits[nm].min + i * (limits[nm].max - limits[nm].min) / 5;
            var txt = l.toFixed(1).toString();
            var size = ctx.measureText(txt);
            ctx.fillText(txt, w - 30 - size.width, _h + 5);
        }

        for (var i = 0; i <= 25; i++) {
            if (i % 5 === 0) continue;
            ctx.beginPath();
            var _h = 10 + (h - 20) / 25 * i;
            ctx.moveTo(w - 5, _h);
            ctx.lineTo(w - 15, _h);
            ctx.stroke();
        }

        $(".meter").css({
            top: 0,
            left: 0,
            position: 'absolute'
        });
    });
};

//load default settings from the backend
loadDefaultSettings = function() {
    var s = JSON.parse(@def_settings);

    project_data.defaultSettings.amperage = s.default_welding_params.amperage;
    project_data.defaultSettings.voltage = s.default_welding_params.voltage;
    project_data.defaultSettings.filler_speed = s.default_welding_params.filler_speed;
};

//get the current value or return with the defaults
getValueAt = function(i) {
    if (project_data.currentValues && project_data.currentValues.length > i)
        return project_data.currentValues[i];

    return project_data.defaultModProps;
};

//switch the visibility of a dataset on the chart
showHideDataset = function(i) {
    project_data.chart.data.datasets[i].hidden = !project_data.chart.data.datasets[i].hidden;
    //show hide axis if not in use
    for (var yi = 0; yi < project_data.chart.options.scales.yAxes.length; yi++) {
        axis = project_data.chart.options.scales.yAxes[yi];
        found = project_data.chart.data.datasets.find(function(e) {
            return e.hidden === false && e.yAxisID == axis.id
        });
        if (!found) {
            axis.display = false;
        } else {
            axis.display = true;
        }
    }
    project_data.chart.update(0);
    localStorage.setItem("dataset_" + i, project_data.chart.data.datasets[i].hidden);
};

project_data.WPS.functions.init();