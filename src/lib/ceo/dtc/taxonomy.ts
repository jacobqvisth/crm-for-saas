/**
 * Structural meaning of a fault code, derived from the code itself rather than
 * from a lookup table.
 *
 * This matters because the code dictionary can only ever cover the *generic*
 * SAE ranges — a `P1525` means different things on a Volvo and a Peugeot, and
 * inventing one name for it would be wrong. The taxonomy here works on 100% of
 * well-formed codes regardless of dictionary coverage, so every code on the
 * page can at least be placed in a system, a functional family and a failure
 * mode.
 */

import { baseCodeValue } from "./parse";

/* ------------------------------------------------------------------ systems */

export type DtcSystemKey = "P" | "B" | "C" | "U";

export const DTC_SYSTEMS: Record<
  DtcSystemKey,
  { label: string; hint: string }
> = {
  P: {
    label: "Powertrain",
    hint: "Engine, fuel, air, ignition, emissions and transmission. The overwhelming majority of what workshops bring to the AI.",
  },
  B: {
    label: "Body",
    hint: "Interior and comfort electronics: airbags and restraints, locking, lighting, climate, instrument cluster.",
  },
  C: {
    label: "Chassis",
    hint: "Braking, ABS/ESP, steering, suspension and wheel-speed sensing.",
  },
  U: {
    label: "Network",
    hint: "Communication faults — a module that stopped answering on the CAN bus, or sent implausible data. Often a symptom of a power or wiring problem rather than a failed module.",
  },
};

/* -------------------------------------------------- powertrain subsystem */

/**
 * SAE J2012 assigns the third character of a P-code to a subsystem. Kept as a
 * separate axis from the functional families below because it is the
 * standard's own grouping and is useful as a sanity check on the families.
 */
export function powertrainSubsystem(base: string): {
  key: string;
  label: string;
} | null {
  if (base[0] !== "P") return null;
  const digit = base[2];
  switch (digit) {
    case "0":
    case "1":
    case "2":
      return { key: "fuel-air", label: "Fuel and air metering" };
    case "3":
      return { key: "ignition", label: "Ignition system or misfire" };
    case "4":
      return { key: "emissions", label: "Auxiliary emission controls" };
    case "5":
      return { key: "speed-idle", label: "Speed, idle and auxiliary inputs" };
    case "6":
      return { key: "ecu", label: "Computer output circuit and ECU" };
    case "7":
    case "8":
    case "9":
      return { key: "transmission", label: "Transmission and drivetrain" };
    case "A":
    case "B":
    case "C":
    case "D":
      return { key: "hybrid", label: "Hybrid and electric propulsion" };
    default:
      return null;
  }
}

/* ------------------------------------------------- functional families */

type FamilyRule = {
  key: string;
  label: string;
  hint: string;
  /**
   * Inclusive base-code ranges. `"P0300-P031F"` covers every code from P0300 to
   * P031F; a bare code (`"P0299"`) is a range of one.
   *
   * Ranges only ever claim territory the standard actually defines. The
   * manufacturer-specific blocks (P1xxx, P3xxx, B1-B3, C1-C3, U1-U3) are left
   * either unclaimed or grouped under a deliberately vague label, because a
   * code like P1525 means different things on a Volvo and a Peugeot and
   * asserting one meaning would be wrong.
   */
  ranges: string[];
};

/**
 * Repair-shop-meaningful groupings, ordered most specific first — a code lands
 * in exactly ONE family (first match wins), so family shares add up to 100% of
 * classified codes. That is deliberately different from the multi-label buckets
 * on the Search Terms page: free text can describe two complaints at once, but
 * a fault code is one thing.
 */
const FAMILY_RULES: FamilyRule[] = [
  {
    key: "misfire",
    label: "Misfire",
    hint: "Random or cylinder-specific combustion failure. The general code (P0300) plus a cylinder code (P0301-P0312) in the same session usually means one cylinder is dragging the whole engine.",
    ranges: ["P0300-P031F"],
  },
  {
    key: "turbo-boost",
    label: "Turbo and boost control",
    hint: "Underboost/overboost, wastegate and variable-geometry actuators, boost pressure sensing. P0299 (underboost) is the single most common fault code in the whole dataset.",
    ranges: [
      "P0033-P0040",
      "P0045-P0049",
      "P0234-P0238",
      "P0243-P0245",
      "P0299",
      "P00BC-P00C6",
      "P2262-P2264",
      "P226C-P2280",
      "P2562-P2566",
    ],
  },
  {
    key: "dpf",
    label: "Diesel particulate filter",
    hint: "DPF efficiency, differential pressure sensing, regeneration and soot loading. Heavily represented because the customer fleet is European diesel.",
    ranges: ["P2002-P2003", "P242F-P243F", "P2448-P2463", "P24C0-P24CF"],
  },
  {
    key: "scr-adblue",
    label: "SCR and AdBlue",
    hint: "NOx after-treatment: reductant dosing, NOx sensors, SCR catalyst efficiency. Distinct from the DPF even though both live in the exhaust.",
    ranges: [
      "P2040-P205F",
      "P2070-P2074",
      "P20E0-P20FF",
      "P2200-P2214",
      "P229E-P229F",
      "P2BA0-P2BAF",
    ],
  },
  {
    key: "egr",
    label: "EGR",
    hint: "Exhaust gas recirculation flow, valve position and cooler. Classic diesel carbon-fouling territory.",
    ranges: ["P0400-P040F", "P0487-P0490", "P2413"],
  },
  {
    key: "catalyst",
    label: "Catalytic converter",
    hint: "Catalyst efficiency below threshold. P0420 is the second most common code overall and is very often a lambda sensor rather than a dead catalyst.",
    ranges: ["P0420-P043F"],
  },
  {
    key: "lambda",
    label: "Lambda and O2 sensors",
    hint: "Oxygen sensor circuits, heaters and response. Includes both the pre-cat sensor that drives fuelling and the post-cat sensor that judges the catalyst.",
    ranges: [
      "P0030-P0032",
      "P0050-P0064",
      "P0130-P0147",
      "P014A-P016F",
      "P2195-P21A0",
      "P2270-P2274",
      "P2A00-P2A0F",
    ],
  },
  {
    key: "fuel-trim",
    label: "Fuel trim: lean or rich",
    hint: "The mixture the ECU cannot correct for. Lean codes (P0171) usually mean unmetered air or a leaking exhaust before the sensor. Seeing lean AND rich together points at the sensor, not the mixture.",
    ranges: ["P0170-P0175", "P2177-P2194"],
  },
  {
    key: "fuel-pressure",
    label: "Fuel pressure and delivery",
    hint: "Rail pressure, high-pressure pump, regulator and metering valve. P0087 (rail pressure too low) shows up with five different failure type bytes, which is the FTB doing real work.",
    ranges: [
      "P0001-P000F",
      "P0087-P0095",
      "P0148-P0149",
      "P018B-P018D",
      "P0190-P0193",
      "P0230-P0233",
      "P0250-P0254",
      "P02E9-P02FA",
    ],
  },
  {
    key: "injector",
    label: "Injectors",
    hint: "Injector circuits and contribution balance. Four adjacent injector codes at once (P0201-P0204) is a harness or connector fault far more often than four dead injectors.",
    ranges: ["P0200-P020F", "P0261-P0296"],
  },
  {
    key: "glow-plug",
    label: "Glow plugs and preheat",
    hint: "Glow plug circuits and the preheat control module. Seasonal: a cold-start complaint that only shows up in winter.",
    ranges: ["P0380-P0382", "P0670-P0685", "P2521-P2522"],
  },
  {
    key: "timing-vvt",
    label: "Valve timing and camshaft",
    hint: "Camshaft/crankshaft correlation, VVT actuators and oil control valves, cam and crank sensors. P0016/P0017 correlation codes are the stretched-timing-chain family.",
    ranges: ["P0010-P002F", "P0335-P0349", "P0365-P0379"],
  },
  {
    key: "ignition",
    label: "Ignition and knock sensing",
    hint: "Ignition coils, engine speed input and knock sensors — the spark side, as opposed to the misfire codes that report the result.",
    ranges: ["P0320-P0334", "P0350-P0364"],
  },
  {
    key: "air-intake",
    label: "Air intake and MAF/MAP",
    hint: "Mass air flow, manifold pressure and intake air temperature sensing, the correlation checks between them, and the intake runner controls.",
    ranges: ["P0068-P006F", "P0100-P0114", "P2004-P2017"],
  },
  {
    key: "throttle",
    label: "Throttle and pedal",
    hint: "Throttle position, throttle actuator and accelerator pedal sensors. Redundant-sensor disagreement here puts the car straight into limp mode.",
    ranges: ["P0120-P0124", "P0220-P0229", "P2100-P2140"],
  },
  {
    key: "cooling",
    label: "Cooling and thermostat",
    hint: "Coolant temperature sensing, thermostat regulation and cooling fans. Often a driveability complaint rather than an overheating one.",
    ranges: [
      "P0115-P011F",
      "P0125-P012A",
      "P0480-P0486",
      "P0691-P0694",
      "P2181-P2185",
    ],
  },
  /**
   * Must stay ahead of `idle-speed`, whose P0500-P0543 range would otherwise
   * swallow the oil pressure codes and file an oil warning under cruise control.
   */
  {
    key: "oil",
    label: "Engine oil and lubrication",
    hint: "Oil pressure and level sensing, and oil pressure control valves. Worth watching on its own: an oil pressure code is the one fault where continuing to drive destroys the engine.",
    ranges: ["P0520-P0529", "P06DD-P06DF", "P250F-P2513"],
  },
  {
    key: "transmission",
    label: "Transmission",
    hint: "Gearbox control, solenoids, clutch and torque converter. P0700 is only a pointer — it says the transmission controller has its own stored code.",
    ranges: ["P0700-P09FF", "P2700-P27FF"],
  },
  {
    key: "charging",
    label: "Charging and system voltage",
    hint: "Battery voltage, alternator and supply rails. Low system voltage cascades: P0562 arrives with a fistful of U-codes because starved modules stop answering.",
    ranges: ["P0560-P0563", "P0620-P0628", "P2500-P2503"],
  },
  {
    key: "evap",
    label: "EVAP and fuel tank",
    hint: "Evaporative emission leaks, purge and vent valves, tank pressure and fuel level sensing. Mostly a petrol-fleet concern.",
    ranges: ["P0440-P046F", "P0496-P049F", "P2066-P2069", "P2400-P2412"],
  },
  {
    key: "exhaust-pressure",
    label: "Exhaust pressure and temperature",
    hint: "Exhaust back-pressure and gas temperature sensing, separate from the DPF logic it feeds.",
    ranges: ["P0470-P047F", "P0544-P0549", "P242A-P242E"],
  },
  {
    key: "ecu-internal",
    label: "ECU internal and software",
    hint: "Control module internal faults, memory, checksums and output-circuit drivers. A high share here is a coding or software problem, not a mechanical one.",
    ranges: ["P0600-P061F", "P0629-P065F"],
  },
  {
    key: "idle-speed",
    label: "Idle and speed control",
    hint: "Idle air control, cruise control, vehicle speed inputs and crankcase ventilation regulation.",
    ranges: ["P0500-P0543", "P054A-P055F", "P0565-P05FF"],
  },
  {
    key: "hybrid-ev",
    label: "Hybrid and EV propulsion",
    hint: "High-voltage battery, inverter and electric drive, from the standardised P0A-P0D block. Small but worth watching as the fleet turns over.",
    ranges: ["P0A00-P0DFF"],
  },
  {
    key: "network",
    label: "Bus communication",
    hint: "Lost communication with a module, or a module reporting implausible data. Rarely the module itself: look for power, ground and connector faults first.",
    ranges: ["U0000-U3FFF"],
  },
  {
    key: "abs-brakes",
    label: "ABS, brakes and stability",
    hint: "The standardised chassis block: wheel speed sensing, ABS/ESP hydraulics and brake switches.",
    ranges: ["C0000-C00FF"],
  },
  {
    key: "chassis-other",
    label: "Chassis, manufacturer-specific",
    hint: "Chassis-domain codes outside the standardised block — braking, steering, suspension or ride control depending on the make. Grouped rather than named because C1-C3 codes mean different things on different vehicles.",
    ranges: ["C0100-C3FFF"],
  },
  {
    key: "restraints",
    label: "Airbags and restraints",
    hint: "The standardised body block, which is largely airbag squibs, belt tensioners and crash sensing. Codes here fail an inspection, so they arrive urgent.",
    ranges: ["B0000-B00FF"],
  },
  {
    key: "body-electrics",
    label: "Body, manufacturer-specific",
    hint: "Body-domain codes outside the standardised block: locking, lighting, climate, cluster and comfort modules. Grouped rather than named for the same reason as the chassis codes.",
    ranges: ["B0100-B3FFF"],
  },
  /**
   * Catch-all for the manufacturer-specific powertrain blocks, and deliberately
   * last so every rule above gets first refusal. Without it roughly a third of
   * all code instances in prod fall out as "not yet classified" purely because
   * they are P1xxx/P3xxx — which says nothing useful, since being
   * manufacturer-specific is the whole point of those ranges. Grouping them the
   * same way the body and chassis codes are grouped is both more informative and
   * more consistent; the SAE subsystem axis still splits them further.
   */
  {
    key: "powertrain-manufacturer",
    label: "Powertrain, manufacturer-specific",
    hint: "Powertrain codes in the P1xxx and P3xxx blocks, which the standard reserves for the manufacturer. The number alone means nothing without knowing the make, so these are grouped rather than named. The subsystem breakdown below still places them by what the standard says the third character means.",
    ranges: ["P1000-P1FFF", "P3000-P3FFF"],
  },
];

type CompiledRange = {
  system: string;
  low: number;
  high: number;
};

type CompiledFamily = {
  key: string;
  label: string;
  hint: string;
  ranges: CompiledRange[];
};

function compileRange(spec: string): CompiledRange {
  const [lowRaw, highRaw] = spec.split("-");
  const low = lowRaw.trim();
  const high = (highRaw ?? lowRaw).trim();
  return {
    system: low[0],
    low: baseCodeValue(low),
    high: baseCodeValue(high),
  };
}

const COMPILED_FAMILIES: CompiledFamily[] = FAMILY_RULES.map((rule) => ({
  key: rule.key,
  label: rule.label,
  hint: rule.hint,
  ranges: rule.ranges.map(compileRange),
}));

export type DtcFamily = {
  key: string;
  label: string;
  hint: string;
};

export const DTC_FAMILY_ORDER: DtcFamily[] = COMPILED_FAMILIES.map((family) => ({
  key: family.key,
  label: family.label,
  hint: family.hint,
}));

export const UNCLASSIFIED_FAMILY: DtcFamily = {
  key: "unclassified",
  label: "Not yet classified",
  hint: "Well-formed codes that no family rule claims — mostly manufacturer-specific ranges whose meaning differs per make. This panel is the intended way to grow the family list.",
};

/**
 * Classifies a base code into exactly one functional family, purely from the
 * code's position in the SAE numbering. First matching rule wins, so family
 * shares add up to 100% of classified codes.
 */
export function classifyFamily(base: string): DtcFamily {
  const system = base[0];
  const value = baseCodeValue(base);

  for (const family of COMPILED_FAMILIES) {
    for (const range of family.ranges) {
      if (range.system !== system) continue;
      if (value < range.low || value > range.high) continue;
      return { key: family.key, label: family.label, hint: family.hint };
    }
  }

  return UNCLASSIFIED_FAMILY;
}

/* ---------------------------------------------------- failure type byte */

/**
 * Failure type bytes, per SAE J2012-DA / ISO 14229-1.
 *
 * The high nibble is the failure *class* and the low nibble the specific mode,
 * so an unlisted byte can still be placed by its family. Only bytes whose
 * meaning is well established in the standard are named individually; the
 * manufacturer-defined ranges (A0-FF) are labelled as such rather than guessed
 * at, because there they genuinely differ per make.
 */
const FTB_NAMES: Record<string, string> = {
  "00": "No sub-type information",
  "01": "General electrical failure",
  "02": "General signal failure",
  "03": "General failure information",
  "04": "System internal failure",
  "05": "System programming failure",
  "06": "Algorithm-based failure",
  "07": "Mechanical failure",
  "08": "Bus signal or message failure",
  "09": "Component failure",
  "11": "Circuit shorted to ground",
  "12": "Circuit shorted to battery",
  "13": "Circuit open",
  "14": "Circuit short to ground or open",
  "15": "Circuit short to battery or open",
  "16": "Circuit voltage below threshold",
  "17": "Circuit voltage above threshold",
  "18": "Circuit current below threshold",
  "19": "Circuit current above threshold",
  "1A": "Circuit resistance below threshold",
  "1B": "Circuit resistance above threshold",
  "1C": "Circuit voltage out of range",
  "1D": "Circuit current out of range",
  "1E": "Circuit resistance out of range",
  "1F": "Circuit intermittent or erratic",
  "20": "Signal invalid",
  "21": "Signal amplitude below minimum",
  "22": "Signal amplitude above maximum",
  "23": "Signal stuck low",
  "24": "Signal stuck high",
  "25": "Signal shape or waveform failure",
  "26": "Signal rate of change below threshold",
  "27": "Signal rate of change above threshold",
  "28": "Signal bias level out of range",
  "29": "Signal invalid",
  "2A": "Signal erratic",
  "2B": "Signal cross-coupled",
  "2C": "Signal frequency out of range",
  "31": "No signal",
  "32": "Signal low time below minimum",
  "33": "Signal high time above maximum",
  "38": "Signal frequency too low",
  "39": "Signal frequency too high",
  "41": "General checksum failure",
  "42": "General memory failure",
  "43": "Special memory failure",
  "44": "Data memory failure",
  "45": "Program memory failure",
  "46": "Calibration or parameter memory failure",
  "47": "Watchdog or safety processor failure",
  "48": "Supervision software failure",
  "49": "Internal electronic failure",
  "4A": "Incorrect component installed",
  "4B": "Over temperature",
  "51": "Not programmed",
  "52": "Not activated or not configured",
  "53": "Not calibrated",
  "54": "Missing calibration",
  "55": "Not configured",
  "56": "Invalid or incompatible software",
  "59": "Configuration or setup failure",
  "5F": "Configuration or setup failure",
  "60": "Algorithm or monitoring failure",
  "61": "Signal calculation failure",
  "62": "Signal compare failure",
  "63": "Actuator stuck",
  "64": "Signal plausibility failure",
  "65": "Signal had component failure",
  "68": "Event information",
  "71": "Actuator stuck",
  "72": "Actuator stuck open",
  "73": "Actuator stuck closed",
  "74": "Actuator slipping",
  "75": "Emergency position not reachable",
  "76": "Incorrect mounting position",
  "77": "Commanded position not reachable",
  "78": "Alignment or mechanical failure",
  "79": "Mechanical linkage failure",
  "7A": "Mechanical deviation",
  "91": "Flow or delivery below expected",
  "92": "Performance or incorrect operation",
  "93": "No operation",
  "94": "Unexpected operation",
  "95": "Incorrect assembly",
  "96": "Component internal failure",
  "97": "Operation obstructed or blocked",
  "98": "Component or system over temperature",
  "99": "Component or system operating conditions",
  "9A": "Component or system inoperative",
};

export type DtcFtbFamily = {
  key: string;
  label: string;
  hint: string;
};

const FTB_FAMILIES: Record<string, DtcFtbFamily> = {
  "0": {
    key: "general",
    label: "General",
    hint: "No sub-type, or a broad electrical/signal/mechanical classification without further detail. `00` means the tool sent a bare code with no failure mode attached.",
  },
  "1": {
    key: "circuit",
    label: "Circuit and electrical",
    hint: "Shorts, opens, and voltage/current/resistance out of range. Points at wiring, connectors and grounds rather than at the component.",
  },
  "2": {
    key: "signal",
    label: "Signal",
    hint: "The wire is intact but the value on it is wrong: stuck, out of range, implausible or erratic. Typically a failing sensor or what it is measuring.",
  },
  "3": {
    key: "signal-timing",
    label: "Signal timing",
    hint: "Missing signal, or frequency and duty cycle outside limits.",
  },
  "4": {
    key: "internal",
    label: "Internal and memory",
    hint: "Checksum, memory and internal electronics failures inside the module itself.",
  },
  "5": {
    key: "programming",
    label: "Programming and calibration",
    hint: "Not programmed, not coded, not calibrated, wrong software. These are workshop-fixable configuration faults, not broken parts — a high share here means a coding job.",
  },
  "6": {
    key: "algorithm",
    label: "Algorithm and plausibility",
    hint: "The module's own monitoring rejected a value as implausible, or two sources disagreed.",
  },
  "7": {
    key: "mechanical",
    label: "Mechanical and actuator",
    hint: "Actuator stuck, slipping, or unable to reach the commanded position. The electrics are fine and something physical is not moving.",
  },
  "8": {
    key: "standardised-other",
    label: "Standardised, group not decoded here",
    hint: "The standard reserves this group but its sub-types are not decoded on this page, so the byte is shown as-is rather than given a meaning it might not have. `87` is the one that shows up in volume.",
  },
  "9": {
    key: "performance",
    label: "Performance",
    hint: "The component works but not well enough, does nothing, or does something unexpected. Wear rather than failure.",
  },
};

const MANUFACTURER_FTB_FAMILY: DtcFtbFamily = {
  key: "manufacturer",
  label: "Manufacturer-defined",
  hint: "Bytes A0-FF are left to the vehicle manufacturer by the standard, so they carry no portable meaning. Shown as-is rather than guessed at.",
};

export function ftbName(ftb: string): string | null {
  return FTB_NAMES[ftb.toUpperCase()] ?? null;
}

export function ftbFamily(ftb: string): DtcFtbFamily {
  const high = ftb.toUpperCase()[0];
  return FTB_FAMILIES[high] ?? MANUFACTURER_FTB_FAMILY;
}
