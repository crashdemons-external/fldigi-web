// Exact settings from cb_rtty45/50/75N/75W/100 in fldigi 4.2.13
// src/dialogs/fl_digi.cxx. All use MODE_RTTY and 5-bit Baudot.
// RTTY-100 is present in the native quick-change menu.
export const rttyPresets = [
  {label:'RTTY-45', rttyBaud:1, rttyShift:3, rttyBits:0},
  {label:'RTTY-50', rttyBaud:2, rttyShift:3, rttyBits:0},
  {label:'RTTY-75N', rttyBaud:4, rttyShift:3, rttyBits:0},
  {label:'RTTY-75W', rttyBaud:4, rttyShift:9, rttyBits:0},
  {label:'RTTY-100', rttyBaud:5, rttyShift:3, rttyBits:0},
];
