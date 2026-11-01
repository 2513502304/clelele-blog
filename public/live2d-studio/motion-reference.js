/** Extract the loaded Unity clip's polynomial knots without seeking or rendering a model. */
export function motionReference(character, selection) {
  const clip = character.clips.get(selection.motion), params = character.core.parameters;
  if (!clip) return { id: '', duration: 1, tracks: [] };
  const duration = clip.length, expression = character.expressions.find(e => e.name === selection.expression);
  const destinations = new Map((expression?.dest || []).map(d => [d.i, d]));
  const streams = new Map(clip.streamed.map(c => [c.param, c]));
  const constants = new Map(clip.constants.map(c => [c.param, c.v]));
  const tracks = [];
  for (const [index, id] of params.ids.entries()) {
    const stream = streams.get(index), destination = destinations.get(index);
    const baseline = character.params.def[index], min = params.minimumValues[index], max = params.maximumValues[index];
    let constant = constants.get(index) ?? baseline;
    if (destination) constant = destination.blend === 1 ? baseline + destination.v : destination.blend === 2 ? baseline * destination.v : destination.v;
    const valueAt = time => {
      if (!stream || destination) return { value: constant, slope: 0 };
      let at = 0;
      while (at + 1 < stream.t.length && stream.t[at + 1] <= time) at++;
      const dt = time - stream.t[at], [a,b,c,d] = stream.k.slice(at*4, at*4+4);
      return { value: ((a*dt+b)*dt+c)*dt+d, slope: (3*a*dt+2*b)*dt+c };
    };
    // Ignore the native sentinel at -Float.MAX_VALUE and include both real clip boundaries.
    const times = [...new Set([0, ...(stream && !destination ? stream.t.filter(t => t > 0 && t < duration) : []), duration])].sort((a,b)=>a-b);
    const keys = times.map((time, at) => {
      const from = valueAt(time), end = times[at+1];
      const incoming = end === undefined ? 0 : valueAt(Math.max(time, end-1e-7)).slope;
      return { time, value: Math.max(min, Math.min(max, from.value)), easing: { type:'hermite', outSlope:from.slope, inSlope:incoming } };
    });
    tracks.push({ id, keys, animated: !!stream && !destination && keys.some(k=>Math.abs(k.value-keys[0].value)>1e-5 || Math.abs(k.easing.outSlope)>1e-5), source:destination?'expression':'motion' });
  }
  return { id: selection.motion + '/' + selection.expression, duration, tracks };
}
