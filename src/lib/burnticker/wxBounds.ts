/**
 * HB-95 (hourly run 7): the daily-high threshold had two bound sets, -60 to 135 °F on the launch page (launchFields.ts) and -40 to 130 °F
 * on the API dial (dials.ts). One set, here, for both. A threshold inside the bounds but outside the station's recorded range is accepted
 * with a warning that names the record (sources/nwsClimate.ts weatherFrequency).
 */
export const WX_HIGH_MIN_F = -60;
export const WX_HIGH_MAX_F = 135;
export const WX_HIGH_RANGE_LINE = `Enter a temperature between ${WX_HIGH_MIN_F} and ${WX_HIGH_MAX_F} °F.`;
