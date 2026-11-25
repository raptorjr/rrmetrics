const {test}=require('node:test');
const assert=require('node:assert/strict');
const {replayDatePopupPosition}=require('./replayDatePopup');
test('date popup fits horizontally, opens above when space is tight below',()=>{
  const style=replayDatePopupPosition({left:490,top:450,bottom:490},320,640,600);
  assert.equal(style.left,280);
  assert.equal(style.top,122);
  assert.equal(style.width,352);
});
test('date popup stays within small viewport without growing its parent form',()=>{
  const style=replayDatePopupPosition({left:180,top:180,bottom:220},480,300,340);
  assert.equal(style.left,8);assert.equal(style.width,284);assert.equal(style.top,8);assert.equal(style.maxHeight,324);
});
