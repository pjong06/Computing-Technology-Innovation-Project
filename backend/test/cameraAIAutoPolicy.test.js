'use strict';
const test=require('node:test');const assert=require('node:assert/strict');
const {validateResult}=require('../camera-ai/gemini-review.cjs');
test('clear no-person image classifications do not request image review',()=>{
  for(const result of [{targets:[],uncertain:false,scene_status:'no_target_detected'},{targets:['animal'],uncertain:false,scene_status:'target_detected'}])assert.equal(validateResult(result).human_review_required,false);
});
test('person, mixed, unclear and uncertain image classifications retain human review',()=>{
  for(const result of [{targets:['person'],uncertain:false,scene_status:'target_detected'},{targets:['person','animal'],uncertain:false,scene_status:'target_detected'},{targets:[],uncertain:true,scene_status:'unclear'},{targets:['animal'],uncertain:true,scene_status:'target_detected'}])assert.equal(validateResult(result).human_review_required,true);
});
test('contradictory and overposted AI outcomes cannot override the review rule',()=>{
  for(const result of [{targets:[],uncertain:false,scene_status:'unclear'},{targets:['person'],uncertain:false,scene_status:'no_target_detected'},{targets:[],uncertain:false,scene_status:'no_target_detected',human_review_required:false}])assert.throws(()=>validateResult(result),/AI_RESULT_INVALID/);
});
