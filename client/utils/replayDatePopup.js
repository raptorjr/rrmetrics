// Keep a date picker outside the scrollable creation form and within the viewport.
function replayDatePopupPosition(rect,contentHeight,viewportWidth,viewportHeight){
  const margin=8,gap=6,width=Math.max(0,Math.min(352,viewportWidth-2*margin));
  const height=Math.min(contentHeight+2,Math.max(0,viewportHeight-2*margin));
  const below=viewportHeight-rect.bottom-gap-margin,above=rect.top-gap-margin;
  const preferred=below>=height?rect.bottom+gap:above>=height?rect.top-gap-height:
    below>=above?rect.bottom+gap:rect.top-gap-height;
  return {width,maxHeight:Math.max(0,viewportHeight-2*margin),
    left:Math.max(margin,Math.min(rect.left,viewportWidth-width-margin)),
    top:Math.max(margin,Math.min(preferred,viewportHeight-height-margin)),visibility:'visible'};
}
module.exports={replayDatePopupPosition};
