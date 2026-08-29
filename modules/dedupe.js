self.GMLE = self.GMLE || {};

GMLE.normalizePhone = function (p) {
  return (p || '').replace(/[^\d+]/g, '');
};

GMLE.normalizeName = function (n) {
  return (n || '').toLowerCase().replace(/[^a-z0-9]/g, '').trim();
};

GMLE.fingerprint = function (l) {
  if (l && l.mapsUrl) return 'U:' + String(l.mapsUrl).split('?')[0];
  var ph = GMLE.normalizePhone(l && l.phone);
  var nm = GMLE.normalizeName(l && l.name);
  if (ph && nm) return 'PN:' + ph + '|' + nm;
  if (nm && l && l.address) return 'NA:' + nm + '|' + GMLE.normalizeName(l.address);
  return 'R:' + ((l && l.name) || '') + '|' + ((l && l.mapsUrl) || '');
};
