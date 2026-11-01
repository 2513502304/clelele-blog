/** Apply a batch atomically: shared pose records keep every unselected parameter. */
export function editPoseKeys(keys, updates, { remove = false, nextId = 1, limit = 64 } = {}) {
  const result = structuredClone(keys), picked = new Set();
  const edits = updates.map(update => {
    const original = keys.find(k => k.id === update.id), parameterId = update.parameterId;
    const token = update.id + '/' + parameterId;
    if (!original || !Number.isFinite(original.values[parameterId]) || picked.has(token)) throw new Error('选中的关键帧已发生变化，请重新选择。');
    picked.add(token);
    const time = update.time ?? original.time, value = update.value ?? original.values[parameterId];
    if (!Number.isFinite(time) || time < 0 || time > 30 || !Number.isFinite(value)) throw new Error('关键帧时间须在 0–30 秒内。');
    return { id:update.id, parameterId, time, value, easing:structuredClone(original.easings?.[parameterId] ?? original.easing ?? 'linear') };
  });
  for (const edit of edits) {
    const key=result.find(k=>k.id===edit.id); delete key.values[edit.parameterId];
    if(key.easings) delete key.easings[edit.parameterId];
  }
  const selection=[];
  if (!remove) for (const edit of edits) {
    let target=result.find(k=>Math.abs(k.time-edit.time)<1e-6);
    if(target && edit.parameterId in target.values) throw new Error('目标位置已有未选中的关键帧，请换一个位置。');
    if(!target){target={id:`key-${nextId++}`,time:edit.time,values:{},easing:'linear'};result.push(target);}
    target.values[edit.parameterId]=edit.value; target.easings={...target.easings,[edit.parameterId]:edit.easing};
    selection.push({id:target.id,parameterId:edit.parameterId});
  }
  const remaining=result.filter(k=>Object.keys(k.values).length).sort((a,b)=>a.time-b.time);
  if(remaining.length>limit) throw new Error('每个人物最多保存 64 个关键帧；本次操作未改变作品。');
  return {keys:remaining,selection,nextId};
}

/** Time stretching preserves normalized curve shape, including absolute native tangents. */
export function scalePoseKeys(keys, factor) {
  return keys.map(key=>{
    const scaleEase=e=>e?.type==='hermite'?{...e,outSlope:e.outSlope/factor,inSlope:e.inSlope/factor}:e;
    return {...key,time:key.time*factor,easing:scaleEase(key.easing),easings:Object.fromEntries(Object.entries(key.easings||{}).map(([id,e])=>[id,scaleEase(e)]))};
  });
}
