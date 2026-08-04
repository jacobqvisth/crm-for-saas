/**
 * Descriptions for *generic* fault codes — the ones SAE J2012 / ISO 15031-6
 * define identically on every vehicle.
 *
 * Deliberately partial, in two ways:
 *
 *  1. Only generic codes are here. The second character of a code says whether
 *     it is generic (`0`, `2`) or manufacturer-specific (`1`, `3`), and a
 *     manufacturer-specific code such as P1525 genuinely means different things
 *     on a Volvo and a Peugeot. Inventing one description for those would put a
 *     confident wrong answer on a dashboard, so the page shows them with their
 *     structural classification and an explicit "manufacturer-specific" note
 *     instead. Roughly a third of the distinct codes in prod are in that bucket.
 *
 *  2. Within the generic ranges this covers the observed head of the
 *     distribution rather than all ~4,000 defined codes. Anything without an
 *     entry still gets a system, a functional family and a failure-mode decode
 *     from `taxonomy.ts`, so it is never a blank row.
 *
 * `dictionaryCoverage()` reports the hit rate so the page can state how much of
 * what it is showing is actually named.
 */

const GENERIC_CODE_NAMES: Record<string, string> = {
  /* --- fuel volume / rail pressure --- */
  P0001: "Fuel volume regulator control circuit open",
  P0002: "Fuel volume regulator control circuit range/performance",
  P0003: "Fuel volume regulator control circuit low",
  P000F: "Fuel system over-pressure relief valve activated",
  P0087: "Fuel rail/system pressure too low",
  P0088: "Fuel rail/system pressure too high",
  P0089: "Fuel pressure regulator 1 performance",
  P0090: "Fuel pressure regulator 1 control circuit",
  P0093: "Fuel system leak detected, large leak",
  P008A: "Low pressure fuel system pressure too low",
  P0148: "Fuel delivery error",
  P0190: "Fuel rail pressure sensor circuit",
  P0191: "Fuel rail pressure sensor circuit range/performance",
  P0192: "Fuel rail pressure sensor circuit low",
  P0193: "Fuel rail pressure sensor circuit high",
  P0230: "Fuel pump primary circuit",
  P0252: "Injection pump fuel metering control A range/performance",
  P0627: "Fuel pump A control circuit open",

  /* --- camshaft / crankshaft timing --- */
  P0008: "Engine position system performance, bank 1",
  P000A: "A camshaft position slow response, bank 1",
  P000B: "B camshaft position slow response, bank 1",
  P0010: "A camshaft position actuator circuit, bank 1",
  P0011: "A camshaft position timing over-advanced or system performance, bank 1",
  P0012: "A camshaft position timing over-retarded, bank 1",
  P0013: "B camshaft position actuator circuit, bank 1",
  P0014: "B camshaft position timing over-advanced or system performance, bank 1",
  P0016: "Crankshaft/camshaft position correlation, bank 1 sensor A",
  P0017: "Crankshaft/camshaft position correlation, bank 1 sensor B",
  P0019: "Crankshaft/camshaft position correlation, bank 2 sensor B",
  P0020: "A camshaft position actuator circuit, bank 2",
  P0075: "Intake valve control solenoid circuit, bank 1",
  P0076: "Intake valve control solenoid circuit low, bank 1",
  P0078: "Exhaust valve control solenoid circuit, bank 1",
  P0079: "Exhaust valve control solenoid circuit low, bank 1",
  P0082: "Intake valve control solenoid circuit low, bank 2",
  P0085: "Exhaust valve control solenoid circuit high, bank 2",
  P0335: "Crankshaft position sensor A circuit",
  P0336: "Crankshaft position sensor A circuit range/performance",
  P0340: "Camshaft position sensor A circuit, bank 1",
  P0341: "Camshaft position sensor A circuit range/performance, bank 1",
  P0343: "Camshaft position sensor A circuit high, bank 1",
  P0344: "Camshaft position sensor A circuit intermittent, bank 1",
  P0345: "Camshaft position sensor A circuit, bank 2",
  P0366: "Camshaft position sensor B circuit range/performance, bank 1",

  /* --- turbo / boost --- */
  P0033: "Turbocharger bypass valve control circuit",
  P003A: "Turbocharger boost control position sensor circuit range/performance",
  P0045: "Turbocharger boost control solenoid circuit open",
  P0047: "Turbocharger boost control solenoid circuit low",
  P0048: "Turbocharger boost control solenoid circuit high",
  P0049: "Turbocharger turbine overspeed",
  P0234: "Turbocharger overboost condition",
  P0236: "Turbocharger boost sensor A circuit range/performance",
  P0238: "Turbocharger boost sensor A circuit high",
  P0243: "Turbocharger wastegate solenoid A",
  P0244: "Turbocharger wastegate solenoid A range/performance",
  P0245: "Turbocharger wastegate solenoid A low",
  P0299: "Turbocharger underboost condition",
  P00AF: "Turbocharger boost control module performance",
  P2262: "Turbocharger boost pressure not detected, mechanical",
  P2263: "Turbocharger boost system performance",
  P2562: "Turbocharger boost control position sensor circuit",
  P2563: "Turbocharger boost control position sensor circuit range/performance",
  P2566: "Turbocharger boost control position sensor circuit high",
  P2279: "Intake air system leak",

  /* --- air metering --- */
  P00BC: "Mass air flow sensor A circuit range/performance, air flow too low",
  P00BD: "Mass air flow sensor A circuit range/performance, air flow too high",
  P0068: "MAP/MAF to throttle position correlation",
  P0069: "MAP to barometric pressure correlation",
  P006A: "MAP to mass air flow correlation",
  P0100: "Mass or volume air flow circuit",
  P0101: "Mass or volume air flow circuit range/performance",
  P0102: "Mass or volume air flow circuit low input",
  P0103: "Mass or volume air flow circuit high input",
  P0105: "Manifold absolute pressure / barometric pressure circuit",
  P0106: "Manifold absolute pressure circuit range/performance",
  P0110: "Intake air temperature sensor 1 circuit",
  P0111: "Intake air temperature sensor 1 circuit range/performance",
  P0113: "Intake air temperature sensor 1 circuit high",
  P0095: "Intake air temperature sensor 2 circuit",
  P2227: "Barometric pressure circuit range/performance",
  P2004: "Intake manifold runner control stuck open, bank 1",
  P2008: "Intake manifold runner control circuit open, bank 1",
  P2009: "Intake manifold runner control circuit low, bank 1",
  P2012: "Intake manifold runner control circuit low, bank 2",
  P2015: "Intake manifold runner position sensor circuit range/performance, bank 1",
  P2016: "Intake manifold runner position sensor circuit low, bank 1",
  P0660: "Intake manifold tuning valve control circuit open, bank 1",
  P0661: "Intake manifold tuning valve control circuit low, bank 1",

  /* --- coolant / cooling --- */
  P0115: "Engine coolant temperature circuit",
  P0116: "Engine coolant temperature circuit range/performance",
  P0117: "Engine coolant temperature circuit low",
  P0118: "Engine coolant temperature circuit high",
  P0128: "Coolant thermostat, coolant below regulating temperature",
  P0217: "Engine coolant over-temperature condition",
  P00B7: "Engine coolant flow low or performance",
  P0480: "Cooling fan 1 control circuit",
  P0483: "Cooling fan rationality check",
  P0495: "Cooling fan speed excessive",
  P0691: "Cooling fan 1 control circuit low",
  P0693: "Cooling fan 2 control circuit low",
  P0694: "Cooling fan 2 control circuit high",
  P2181: "Cooling system performance",
  P2556: "Engine coolant level sensor circuit range/performance",
  P2560: "Engine coolant level low",
  P2600: "Coolant pump A control circuit open",

  /* --- lambda / O2 --- */
  P0030: "O2 sensor heater control circuit, bank 1 sensor 1",
  P0031: "O2 sensor heater control circuit low, bank 1 sensor 1",
  P0037: "O2 sensor heater control circuit low, bank 1 sensor 2",
  P0040: "O2 sensor signals swapped, bank 1 sensor 1 / bank 2 sensor 1",
  P0051: "O2 sensor heater control circuit low, bank 2 sensor 1",
  P0130: "O2 sensor circuit, bank 1 sensor 1",
  P0131: "O2 sensor circuit low voltage, bank 1 sensor 1",
  P0132: "O2 sensor circuit high voltage, bank 1 sensor 1",
  P0133: "O2 sensor circuit slow response, bank 1 sensor 1",
  P0134: "O2 sensor circuit no activity detected, bank 1 sensor 1",
  P0135: "O2 sensor heater circuit, bank 1 sensor 1",
  P0136: "O2 sensor circuit, bank 1 sensor 2",
  P0137: "O2 sensor circuit low voltage, bank 1 sensor 2",
  P0138: "O2 sensor circuit high voltage, bank 1 sensor 2",
  P0139: "O2 sensor circuit slow response, bank 1 sensor 2",
  P0140: "O2 sensor circuit no activity detected, bank 1 sensor 2",
  P0141: "O2 sensor heater circuit, bank 1 sensor 2",
  P0151: "O2 sensor circuit low voltage, bank 2 sensor 1",
  P0154: "O2 sensor circuit no activity detected, bank 2 sensor 1",
  P0157: "O2 sensor circuit low voltage, bank 2 sensor 2",
  P2196: "O2 sensor signal biased or stuck rich, bank 1 sensor 1",
  P2237: "O2 sensor positive current control circuit open, bank 1 sensor 1",
  P2251: "O2 sensor negative current control circuit open, bank 1 sensor 1",
  P2270: "O2 sensor signal biased or stuck lean, bank 1 sensor 2",
  P2A00: "O2 sensor circuit range/performance, bank 1 sensor 1",

  /* --- fuel trim --- */
  P0170: "Fuel trim, bank 1",
  P0171: "System too lean, bank 1",
  P0172: "System too rich, bank 1",
  P0174: "System too lean, bank 2",
  P2096: "Post-catalyst fuel trim system too lean, bank 1",
  P2177: "System too lean off idle, bank 1",
  P2178: "System too rich off idle, bank 1",
  P2187: "System too lean at idle, bank 1",
  P2188: "System too rich at idle, bank 1",
  P0183: "Fuel temperature sensor A circuit high",
  P0184: "Fuel temperature sensor A circuit intermittent",
  P2269: "Water in fuel condition",
  P2293: "Fuel pressure regulator 2 performance",

  /* --- injectors --- */
  P0201: "Injector circuit open, cylinder 1",
  P0202: "Injector circuit open, cylinder 2",
  P0203: "Injector circuit open, cylinder 3",
  P0204: "Injector circuit open, cylinder 4",
  P0207: "Injector circuit open, cylinder 7",
  P0261: "Cylinder 1 injector circuit low",
  P0263: "Cylinder 1 contribution or balance",
  P0268: "Cylinder 3 injector circuit high",
  P0272: "Cylinder 4 contribution or balance",
  P0276: "Cylinder 5 contribution or balance",
  P2146: "Fuel injector group A supply voltage circuit open",

  /* --- misfire / ignition --- */
  P0300: "Random or multiple cylinder misfire detected",
  P0301: "Cylinder 1 misfire detected",
  P0302: "Cylinder 2 misfire detected",
  P0303: "Cylinder 3 misfire detected",
  P0304: "Cylinder 4 misfire detected",
  P0305: "Cylinder 5 misfire detected",
  P0306: "Cylinder 6 misfire detected",
  P0313: "Misfire detected with low fuel",
  P0320: "Ignition or distributor engine speed input circuit",
  P0321: "Ignition or distributor engine speed input circuit range/performance",
  P0322: "Ignition or distributor engine speed input circuit, no signal",
  P0325: "Knock sensor 1 circuit, bank 1",
  P0350: "Ignition coil primary/secondary circuit",

  /* --- glow plugs --- */
  P0380: "Glow plug or heater circuit A",
  P0671: "Cylinder 1 glow plug circuit",
  P0672: "Cylinder 2 glow plug circuit",
  P0675: "Cylinder 5 glow plug circuit",
  P0683: "Glow plug control module to PCM communication circuit",
  P0684: "Glow plug control module to PCM communication circuit range/performance",

  /* --- EGR --- */
  P0400: "Exhaust gas recirculation flow",
  P0401: "Exhaust gas recirculation flow insufficient",
  P0402: "Exhaust gas recirculation flow excessive",
  P0403: "Exhaust gas recirculation control circuit",
  P0404: "Exhaust gas recirculation control circuit range/performance",
  P0407: "Exhaust gas recirculation sensor B circuit low",
  P0409: "Exhaust gas recirculation sensor A circuit",
  P2141: "Exhaust gas recirculation throttle control circuit low",
  P2413: "Exhaust gas recirculation system performance",
  P2426: "Exhaust gas recirculation cooling valve control circuit low",

  /* --- catalyst --- */
  P0420: "Catalyst system efficiency below threshold, bank 1",
  P0426: "Catalyst temperature sensor circuit range/performance, bank 1",
  P0430: "Catalyst system efficiency below threshold, bank 2",

  /* --- DPF --- */
  P2002: "Diesel particulate filter efficiency below threshold, bank 1",
  P2003: "Diesel particulate filter efficiency below threshold, bank 2",
  P2452: "Diesel particulate filter pressure sensor A circuit",
  P2453: "Diesel particulate filter pressure sensor A circuit range/performance",
  P2454: "Diesel particulate filter pressure sensor A circuit low",
  P2455: "Diesel particulate filter pressure sensor A circuit high",
  P2458: "Diesel particulate filter regeneration duration",
  P2459: "Diesel particulate filter regeneration frequency",
  P2463: "Diesel particulate filter restriction, soot accumulation",

  /* --- SCR / AdBlue / NOx --- */
  P20EE: "SCR NOx catalyst efficiency below threshold, bank 1",
  P2043: "Reductant tank temperature sensor circuit",
  P2062: "Reductant supply control circuit low",
  P2202: "NOx sensor circuit range/performance, bank 1",
  P2203: "NOx sensor circuit high, bank 1",

  /* --- exhaust pressure and temperature --- */
  P0470: "Exhaust pressure sensor",
  P0471: "Exhaust pressure sensor range/performance",
  P0472: "Exhaust pressure sensor A circuit low",
  P0545: "Exhaust gas temperature sensor circuit low, bank 1 sensor 1",

  /* --- EVAP / secondary air --- */
  P0441: "Evaporative emission system incorrect purge flow",
  P0442: "Evaporative emission system leak detected, small leak",
  P0443: "Evaporative emission system purge control valve circuit",
  P0444: "Evaporative emission system purge control valve circuit open",
  P0451: "Evaporative emission system pressure sensor range/performance",
  P0456: "Evaporative emission system leak detected, very small leak",
  P0457: "Evaporative emission system leak detected, fuel cap loose or off",
  P0491: "Secondary air injection system insufficient flow, bank 1",
  P0492: "Secondary air injection system insufficient flow, bank 2",
  P2400: "Evaporative emission leak detection pump control circuit open",
  P2431: "Secondary air injection air flow/pressure sensor range/performance, bank 1",
  P2442: "Secondary air injection switching valve stuck closed, bank 2",
  P0461: "Fuel level sensor A circuit range/performance",
  P2066: "Fuel level sensor B circuit range/performance",

  /* --- throttle / pedal --- */
  P0120: "Throttle or pedal position sensor A circuit",
  P0121: "Throttle or pedal position sensor A circuit range/performance",
  P0122: "Throttle or pedal position sensor A circuit low",
  P0221: "Throttle or pedal position sensor B circuit range/performance",
  P0222: "Throttle or pedal position sensor B circuit low",
  P0223: "Throttle or pedal position sensor B circuit high",
  P0638: "Throttle actuator A control range/performance, bank 1",
  P2100: "Throttle actuator control motor circuit open",
  P2101: "Throttle actuator control motor circuit range/performance",
  P2102: "Throttle actuator control motor circuit low",
  P2110: "Throttle actuator control system, forced limited RPM",
  P2121: "Throttle or pedal position sensor D circuit range/performance",
  P2122: "Throttle or pedal position sensor D circuit low input",
  P2125: "Throttle or pedal position sensor E circuit",
  P2135: "Throttle or pedal position sensor A/B voltage correlation",
  P2138: "Throttle or pedal position sensor D/E voltage correlation",
  P2299: "Brake pedal and accelerator pedal position incompatible",
  P2638: "Torque management feedback signal A range/performance",

  /* --- idle, speed, oil, brakes --- */
  P0215: "Engine shutoff solenoid",
  P0501: "Vehicle speed sensor A range/performance",
  P0504: "Brake switch A/B correlation",
  P0505: "Idle air control system",
  P0507: "Idle air control system RPM higher than expected",
  P0513: "Incorrect immobiliser key",
  P0521: "Engine oil pressure sensor or switch range/performance",
  P0524: "Engine oil pressure too low",
  P250F: "Engine oil level too low",
  P0553: "Power steering pressure sensor A circuit high",
  P0571: "Brake switch A circuit",
  P0703: "Brake switch B circuit",
  P2519: "A/C request A circuit",
  P0645: "A/C clutch relay control circuit",
  P0647: "A/C clutch relay control circuit high",
  P2647: "A rocker arm actuator system performance or stuck off, bank 1",

  /* --- system voltage / ECU --- */
  P0560: "System voltage",
  P0562: "System voltage low",
  P0604: "Internal control module RAM error",
  P0606: "ECM/PCM processor",
  P060B: "Internal control module A/D processing performance",
  P060C: "Internal control module main processor performance",
  P0621: "Generator lamp or L terminal control circuit",
  P0632: "Odometer not programmed in ECM/PCM",
  P0641: "Sensor reference voltage A circuit open",
  P0657: "Actuator supply voltage A circuit open",
  P0685: "ECM/PCM power relay control circuit open",
  P0686: "ECM/PCM power relay control circuit low",
  P2500: "Generator lamp or L terminal circuit low",

  /* --- transmission --- */
  P0700: "Transmission control system, MIL request",
  P0702: "Transmission control system electrical",
  P0715: "Input or turbine speed sensor A circuit",
  P0720: "Output speed sensor circuit",
  P0725: "Engine speed input circuit",
  P0740: "Torque converter clutch circuit open",
  P0741: "Torque converter clutch circuit performance or stuck off",
  P0743: "Torque converter clutch circuit electrical",
  P0750: "Shift solenoid A",
  P0751: "Shift solenoid A performance or stuck off",
  P0760: "Shift solenoid C",
  P0766: "Shift solenoid D performance or stuck off",
  P0807: "Clutch position sensor circuit low",
  P0809: "Clutch position sensor circuit intermittent",
  P0810: "Clutch position control error",
  P0830: "Clutch pedal switch A circuit",
  P0833: "Clutch pedal switch B circuit",
  P0841: "Transmission fluid pressure sensor A circuit range/performance",
  P0850: "Park or neutral switch input circuit",
  P0856: "Traction control input signal",
  P0868: "Transmission fluid pressure low",
  P0883: "TCM power input signal high",
  P2711: "Unexpected mechanical gear disengagement",
  P2762: "Torque converter clutch pressure control solenoid circuit range/performance",
  P2763: "Torque converter clutch pressure control solenoid circuit high",
  P2764: "Torque converter clutch pressure control solenoid circuit low",

  /* --- hybrid --- */
  P0A0F: "Engine failed to start",

  /* --- network: lost communication --- */
  U0001: "High speed CAN communication bus",
  U0019: "Low speed CAN communication bus",
  U0100: "Lost communication with ECM/PCM A",
  U0101: "Lost communication with transmission control module",
  U0102: "Lost communication with transfer case control module",
  U0103: "Lost communication with gear shift module",
  U0106: "Lost communication with glow plug control module",
  U0107: "Lost communication with throttle actuator control module",
  U0115: "Lost communication with ECM/PCM B",
  U0118: "Lost communication with fuel pump control module",
  U0121: "Lost communication with ABS control module",
  U0122: "Lost communication with vehicle dynamics control module",
  U0131: "Lost communication with power steering control module",
  U0132: "Lost communication with ride level control module",
  U0140: "Lost communication with body control module",
  U0141: "Lost communication with body control module A",
  U0155: "Lost communication with instrument panel cluster",
  U0159: "Lost communication with parking assist control module",
  U0164: "Lost communication with HVAC control module",
  U0167: "Lost communication with immobiliser control module",
  U0168: "Lost communication with vehicle security control module",
  U0199: "Lost communication with door control module A",

  /* --- network: invalid data --- */
  U0400: "Invalid data received",
  U0401: "Invalid data received from ECM/PCM A",
  U0402: "Invalid data received from transmission control module",
  U0403: "Invalid data received from transfer case control module",
  U0415: "Invalid data received from ABS control module",
  U0416: "Invalid data received from vehicle dynamics control module",
  U0418: "Invalid data received from brake system control module",
  U0420: "Invalid data received from power steering control module",
  U0423: "Invalid data received from instrument panel cluster",
  U0428: "Invalid data received from steering angle sensor module",

  /* --- restraints --- */
  B0001: "Driver frontal stage 1 deployment control",
  B0010: "Passenger frontal stage 1 deployment control",

  /* --- wheel speed --- */
  C0031: "Left front wheel speed sensor circuit",
  C0034: "Right front wheel speed sensor circuit",
  C0037: "Left rear wheel speed sensor circuit",
  C0040: "Right rear wheel speed sensor circuit",
};

/** Description for a base code, or null when it is not a named generic code. */
export function codeName(base: string): string | null {
  return GENERIC_CODE_NAMES[base.toUpperCase()] ?? null;
}

export function dictionarySize() {
  return Object.keys(GENERIC_CODE_NAMES).length;
}
