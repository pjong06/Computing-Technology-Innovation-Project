'use strict';
(function(root,factory){if(typeof module==='object')module.exports=factory();else root.workspaceAlertTitle=factory();})(globalThis,()=>{
  return function alertTitle(message){
    const raw=String(message||'');
    const text=raw.trim(),open=text.lastIndexOf('(');
    const suffix=open>=0&&text.endsWith(')')?text.slice(open+1,-1):'';
    const metric=/^[a-z_]+$/.test(suffix)?suffix:null;
    const name=metric?text.slice(0,open).trim():text;
    const high=/\b(high|above|exceeds?|heavy|hot)\b|>=?/.test(name.toLowerCase());
    const low=/\b(low|below|dry|cold)\b|<=?/.test(name.toLowerCase());
    const level=(upper,lower,neutral)=>high&&!low?upper:low&&!high?lower:neutral;
    switch(metric){
      case 'movement_nearby_cm':return 'Movement detected near station';
      case 'movement_detected':return 'Motion detected';
      case 'temperature_c':return level('High temperature','Low temperature','Temperature alert');
      case 'humidity_percent':return level('High humidity','Low humidity','Humidity alert');
      case 'soil_moisture_pct':return level('High soil moisture','Low soil moisture','Soil moisture alert');
      case 'rain_intensity_pct':return level('Heavy rain detected','Low rain intensity','Rain alert');
      case 'battery_percent':return level('High battery level','Low battery','Battery alert');
      case 'vibration_level':return level('High vibration','Low vibration','Vibration detected');
      default:return /\bstation\b.*\b(offline|stopped reporting)\b/i.test(name)?'Station offline':name||'Sensor alert';
    }
  };
});
