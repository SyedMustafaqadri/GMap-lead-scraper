self.GMLE = self.GMLE || {};

GMLE.sanitize = function (s) {
  return (s || '').replace(/[\\/:*?"<>|]+/g, '-').replace(/\s+/g, ' ').trim().slice(0, 80);
};

GMLE.buildXlsx = function (leads, fields) {
  var rows = leads.map(function (l) {
    var r = {};
    fields.forEach(function (f) { r[f.label] = (l[f.key] != null ? l[f.key] : ''); });
    return r;
  });
  var ws = XLSX.utils.json_to_sheet(rows);
  var wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Leads');
  var b64 = XLSX.write(wb, { bookType: 'xlsx', type: 'base64' });
  return 'data:application/vnd.openxmlformats-officedocument.spreadsheetml.sheet;base64,' + b64;
};

GMLE.filenameFor = function (job) {
  var q = GMLE.sanitize((job && job.searchQuery) || 'maps').replace(/\s+/g, '-');
  var d = new Date();
  var p = function (n) { return String(n).padStart(2, '0'); };
  var ts = '' + d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + '-' +
    p(d.getHours()) + p(d.getMinutes());
  return GMLE.sanitize(q + '-' + ts + '.xlsx');
};
