'use strict';
// (a) Card classification tests: restaurant-layout per-part parsing, sponsored
// skip, clinic regression, structured rating, card website hook.
var harness = require('./harness.js');
var assert = harness.assert;

function leadFor(env, card) {
  return env.GMLE.extractors.fromAnchor(card.anchor);
}

var env = harness.load();

// --- Restaurant layout: rating+price share one line, no phone line ---------
var rest = { name: 'Kohinoor Bistro',
  href: 'https://www.google.com/maps/place/Kohinoor+Bistro/1',
  lines: ['Kohinoor Bistro',
    '4.7(4,699) · Rs 1,000–7,000',
    'Restaurant · B231 Johar Hill Rd',
    'Open · Closes 1:30 AM',
    '“Truly great biryani and lovely staff.”'],
  starsAria: '4.7 stars 4,699 Reviews' };
var clinicA = { name: 'The Dental Clinic Dr. Saqib Minhas',
  href: 'https://www.google.com/maps/place/The+Dental+Clinic/2',
  lines: ['The Dental Clinic Dr. Saqib Minhas',
    'Dental clinic · B276, Street 4 Shahjahan Ave',
    'Closed · Opens 10 AM Mon · 0331 2048149'],
  telHref: 'tel:+922133220642',
  starsAria: '4.9 stars 243 Reviews',
  websiteHref: 'https://toclinic.net/' };
var clinicB = { name: 'Smile Care',
  href: 'https://www.google.com/maps/place/Smile+Care/3',
  lines: ['Smile Care',
    'Dentist',
    'Closed · Opens 9 AM Mon · +92 21 36641625',
    'Family-friendly · Dine-in · 4.6(1,095)'] };
var clinicC = { name: 'Pearl Dental',
  href: 'https://www.google.com/maps/place/Pearl+Dental/4',
  lines: ['Pearl Dental',
    'Dental clinic',
    'Closed · Opens 10 AM Mon · 0331 2048149'] };
var cafe = { name: 'Cafe X',
  href: 'https://www.google.com/maps/place/Cafe+X/5',
  lines: ['Cafe X', '4.5(123)', 'Cafe · Main Blvd, Gulberg'] };
var visited = { name: 'A-1 Auto Repair',
  href: 'https://www.google.com/maps/place/A-1+Auto+Repair/7',
  lines: ['A-1 Auto Repair · Visited link', 'Auto repair shop · 2025 Broadway'] };
var dinky = { name: 'Dinky Diner',
  href: 'https://www.google.com/maps/place/Dinky+Diner/8',
  lines: ['Dinky Diner', 'Diner · 36339-36343 S River Rd', 'Closed · Opens 8 AM'] };
var dinerWithPhone = { name: 'X Diner',
  href: 'https://www.google.com/maps/place/X+Diner/9',
  lines: ['X Diner', 'Diner · 123 Main St', 'Closed · Opens 8 AM · 0900 1234567'] };
var sponsored = { name: 'Ad Cafe',
  href: 'https://www.google.com/maps/place/Ad+Cafe/6',
  lines: ['Ad Cafe', 'Restaurant · Some Rd 1'],
  sponsored: true,
  websiteHref: 'https://www.google.com/aclk?sa=l&adurl=https://ad.example.com' };

harness.buildFeed(env, [rest, clinicA, clinicB, clinicC, cafe, sponsored, visited, dinky, dinerWithPhone]);

var L;
var failed = [];
function t(name, fn) {
  try { fn(); console.log('  ok  ' + name); } catch (e) { failed.push(name); console.log('  FAIL ' + name + ' :: ' + e.message); }
}

console.log('restaurant layout:');
L = leadFor(env, rest);
t('name', function () { assert(L.name === 'Kohinoor Bistro', 'name=' + L.name); });
t('category=Restaurant (no rating leak)', function () { assert(L.category === 'Restaurant', 'category=' + L.category); });
t('real address (no price leak)', function () { assert(L.address === 'B231 Johar Hill Rd', 'address=' + L.address); });
t('rating from stars aria-label', function () { assert(L.rating === '4.7', 'rating=' + L.rating); });
t('reviews parsed from aria-label (comma count)', function () { assert(L.reviews === '4699', 'reviews=' + L.reviews); });
t('no phone on restaurant card (phase 2 fills it)', function () { assert(L.phone == null, 'phone=' + L.phone); });
t('no quoted review leak into category', function () { assert(!/biryani/.test(L.category || ''), 'category=' + L.category); });
t('mapsUrl stripped of params', function () { assert(L.mapsUrl === 'https://www.google.com/maps/place/Kohinoor+Bistro/1', L.mapsUrl); });

console.log('clinic layout (regression):');
L = leadFor(env, clinicA);
t('phone from tel: link wins', function () { assert(L.phone === '+922133220642', 'phone=' + L.phone); });
t('category', function () { assert(L.category === 'Dental clinic', 'category=' + L.category); });
t('address', function () { assert(L.address === 'B276, Street 4 Shahjahan Ave', 'address=' + L.address); });
t('website from a[data-value=Website]', function () { assert(L.website === 'https://toclinic.net/', 'website=' + L.website); });
t('rating/reviews', function () { assert(L.rating === '4.9' && L.reviews === '243', L.rating + '/' + L.reviews); });

L = leadFor(env, clinicB);
t('plus-country phone lifted from status line', function () { assert(L.phone === '+922136641625', 'phone=' + L.phone); });
t('category from its own line', function () { assert(L.category === 'Dentist', 'category=' + L.category); });
t('attribute chips + rating tail line skipped', function () {
  assert(L.address == null && L.category === 'Dentist', 'category=' + L.category + ' address=' + L.address);
});

L = leadFor(env, clinicC);
t('local phone lifted from pure-number status part', function () { assert(L.phone === '03312048149', 'phone=' + L.phone); });
t('category/address', function () { assert(L.category === 'Dental clinic', 'category=' + L.category); });

console.log('rating fallback + sponsored:');
L = leadFor(env, cafe);
t('rating from innerText when no stars span', function () { assert(L.rating === '4.5' && L.reviews === '123', L.rating + '/' + L.reviews); });
t('rating line does not leak into category', function () { assert(L.category === 'Cafe', 'category=' + L.category); });
t('address', function () { assert(L.address === 'Main Blvd, Gulberg', 'address=' + L.address); });

L = leadFor(env, visited);
t('"· Visited link" suffix stripped from name', function () {
  assert(L.name === 'A-1 Auto Repair', 'name=' + L.name);
});
t('visited card data still parsed', function () {
  assert(L.category === 'Auto repair shop' && L.address === '2025 Broadway', L.category + '/' + L.address);
});

console.log('phone-vs-address disambiguation:');
L = leadFor(env, dinky);
t('address range digits NOT captured as phone (Dinky Diner)', function () {
  assert(L.phone == null, 'phone=' + L.phone);
});
t('address still parsed', function () {
  assert(L.address === '36339-36343 S River Rd', 'address=' + L.address);
  assert(L.category === 'Diner', 'category=' + L.category);
});
L = leadFor(env, dinerWithPhone);
t('real phone on a non-address line still captured', function () {
  assert(L.phone === '09001234567', 'phone=' + L.phone);
});

L = leadFor(env, sponsored);
t('sponsored card skipped entirely', function () { assert(L == null, 'expected null, got ' + JSON.stringify(L)); });

t('aclk website href rejected by websiteOf', function () {
  var w = env.GMLE.selectors.websiteOf(sponsored.card);
  assert(w == null, 'website=' + w);
});

if (failed.length) { console.log('\nFAILED: ' + failed.join(', ')); process.exit(1); }
console.log('\nALL PASS');
