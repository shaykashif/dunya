import { r3 } from "../log/events.ts";
import type { SimConfig } from "../scenario/config.ts";
import { SEASON_NAMES, WEATHERS, type SeasonName, type Weather } from "./types.ts";
import type { World } from "./world.ts";

export interface Clock {
  tick: number;
  minuteOfDay: number;
  hour: number; // fractional hour of day
  day: number; // days since the run started
  dayOfYear: number;
  season: number; // 0 spring .. 3 winter
  seasonName: SeasonName;
  year: number;
}

export interface EnvState extends Clock {
  light: number;
  temperature: number;
  weather: Weather;
  weatherSince: number;
  well: number;
  droughtUntilDay: number;
}

export function clockAt(cfg: SimConfig, tick: number): Clock {
  const t = cfg.time;
  const absMin = t.startHour * 60 + tick * t.minutesPerTick;
  const day = Math.floor(absMin / 1440);
  const minuteOfDay = absMin - day * 1440;
  const yearDays = t.daysPerSeason * 4;
  const absDay = t.startDayOfYear + day;
  const dayOfYear = absDay % yearDays;
  const season = Math.floor(dayOfYear / t.daysPerSeason);
  return {
    tick,
    minuteOfDay,
    hour: minuteOfDay / 60,
    day,
    dayOfYear,
    season,
    seasonName: SEASON_NAMES[season]!,
    year: Math.floor(absDay / yearDays),
  };
}

/** Light in [0, 1]: darkest around darkestHour, brightest twelve hours later. */
export function lightAt(cfg: SimConfig, hour: number, weather: Weather): number {
  const raw = 0.5 - 0.5 * Math.cos((2 * Math.PI * (hour - cfg.light.darkestHour)) / 24);
  const shaped = Math.min(1, Math.max(0, (raw - 0.35) / 0.6));
  return Math.max(cfg.light.moonlight, shaped * cfg.light.weatherFactor[weather]);
}

/** Seasonal mean, interpolated between mid-season points so it changes smoothly. */
export function seasonalMean(cfg: SimConfig, dayOfYear: number): number {
  const len = cfg.time.daysPerSeason;
  const means = cfg.temperature.seasonMeans;
  const pos = (dayOfYear - len / 2 + len * 4) % (len * 4);
  const i = Math.floor(pos / len);
  const f = (pos - i * len) / len;
  const a = means[i % 4]!, b = means[(i + 1) % 4]!;
  return a + (b - a) * f;
}

export function temperatureAt(cfg: SimConfig, c: Clock, weather: Weather): number {
  const swing = cfg.temperature.dailySwing * Math.cos((2 * Math.PI * (c.hour - cfg.temperature.warmestHour)) / 24);
  return seasonalMean(cfg, c.dayOfYear) + swing + cfg.temperature.weatherOffset[weather];
}

export function initEnv(cfg: SimConfig): EnvState {
  const c = clockAt(cfg, 0);
  const weather: Weather = "clear";
  return {
    ...c,
    light: lightAt(cfg, c.hour, weather),
    temperature: temperatureAt(cfg, c, weather),
    weather,
    weatherSince: 0,
    well: 1,
    droughtUntilDay: -1,
  };
}

function constrainWeather(cfg: SimConfig, w: Weather, temp: number): Weather {
  if (w === "snow" && temp > cfg.weather.snowMaxTemp) return "rain";
  if (w === "rain" && temp < cfg.weather.rainToSnowBelow) return "snow";
  return w;
}

export function isPrecipitating(w: Weather): boolean {
  return w === "rain" || w === "storm" || w === "snow";
}

/** Step 1 of the tick: clock, light, temperature, weather, well. Only the engine calls this. */
export function updateEnvironment(w: World): void {
  const cfg = w.config;
  const env = w.env;
  const prevDay = env.day;
  Object.assign(env, clockAt(cfg, w.tick));

  if (w.tick > 0 && w.tick % cfg.weather.changeEveryTicks === 0) {
    const rng = w.rng.get("weather");
    const row = cfg.weather.transitions[env.seasonName][env.weather];
    const next = WEATHERS[rng.weighted(row)]!;
    const baseTemp = temperatureAt(cfg, env, next);
    const constrained = constrainWeather(cfg, next, baseTemp);
    if (constrained !== env.weather) {
      w.emit("weather_changed", [], { from: env.weather, to: constrained });
      env.weather = constrained;
      env.weatherSince = w.tick;
    }
  }

  env.temperature = temperatureAt(cfg, env, env.weather);
  const fixed = constrainWeather(cfg, env.weather, env.temperature);
  if (fixed !== env.weather) {
    w.emit("weather_changed", [], { from: env.weather, to: fixed });
    env.weather = fixed;
    env.weatherSince = w.tick;
  }
  env.light = lightAt(cfg, env.hour, env.weather);

  if (env.day !== prevDay) {
    const rng = w.rng.get("environment");
    if (env.day > env.droughtUntilDay && rng.chance(cfg.water.droughtChancePerDay[env.season]!)) {
      env.droughtUntilDay = env.day + cfg.water.droughtDays;
      w.emit("drought_started", [], { untilDay: env.droughtUntilDay });
    }
  }
  const drought = env.day <= env.droughtUntilDay;
  let refill = cfg.water.wellRefillPerTick * (drought ? cfg.water.droughtRefillFactor : 1);
  if (env.weather === "rain" || env.weather === "storm") refill += cfg.water.rainRefillPerTick;
  env.well = Math.min(1, env.well + refill);
}

export function envSummary(env: EnvState): Record<string, unknown> {
  return {
    day: env.day,
    hour: r3(env.hour),
    season: env.seasonName,
    light: r3(env.light),
    temp: r3(env.temperature),
    weather: env.weather,
    well: r3(env.well),
  };
}
