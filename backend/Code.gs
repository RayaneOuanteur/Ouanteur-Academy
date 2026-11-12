/**
 * Tunnel de prospects : enregistre chaque demande dans Google Sheets, identifie les 20 premiers
 * admissibles à l'offre, envoie les courriels de confirmation et de relance.
 *
 * Installation : voir LISEZMOI.md (5 minutes). Ce script se colle dans Extensions > Apps Script
 * d'un Google Sheet vide, puis se déploie comme « application Web ».
 */

/* ================= RÉGLAGES ================= */
const CONFIG = {
  SCHOOL_NAME: 'Ouanteur Academy',
  TOTAL_SEATS: 20,              // nombre de places à -20 % (doit être identique à totalSeats dans index.html)
  DISCOUNT: '20 %',
  OWNER_EMAIL: 'ouanteur.academy@gmail.com', // reçoit une alerte à chaque nouveau prospect
  REPLY_TO: 'ouanteur.academy@gmail.com',    // adresse qui reçoit les réponses des prospects
  BOOKING_URL: '',              // lien de prise de rendez-vous (Calendly, Google Agenda…), facultatif
  SENDER_ADDRESS: '',           // adresse postale de l'école : exigée dans les courriels commerciaux au Canada (LCAP/CASL)
  OFFER_DAYS: 7,                // durée pendant laquelle la place à -20 % est réservée
  FOLLOWUP_DAYS: [2, 5],        // relances envoyées 2 jours et 5 jours après la demande
  TIMEZONE: 'America/Toronto'
};

const SHEET_PROSPECTS = 'Prospects';
const SHEET_DASH = 'Tableau de bord';
const SHEET_TOP = '20 premiers';
const ST_OK = 'Admissible';
const ST_WAIT = "Liste d'attente";
const COMMERCIAL = ['Nouveau', 'Contacté', 'Test de niveau planifié', 'Inscrit', 'Perdu', 'Désabonné'];
const LEVELS = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2', 'unknown'];

const HEADERS = ['ID', 'Date', 'Rang', 'Statut offre', 'Prénom', 'Nom', 'E-mail', 'Ville',
  'Source', 'Support', 'Campagne', 'Contenu', 'Mot-clé', 'GCLID', 'FBCLID', 'Page', 'Référent',
  'Consentement', 'Relances envoyées', 'Statut commercial', 'Notes', 'Niveau'];
const COL = {};
HEADERS.forEach(function (h, i) { COL[h] = i + 1; });

/* ================= WEB APP ================= */

function doGet(e) {
  const action = e && e.parameter && e.parameter.action;
  if (action === 'stats') {
    const s = stats_();
    return json_({ ok: true, prises: s.admissibles, total: CONFIG.TOTAL_SEATS, demandes: s.demandes });
  }
  return json_({ ok: true, service: 'prospects' });
}

function doPost(e) {
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(20000);
  } catch (err) {
    return json_({ ok: false, erreur: 'occupe' });
  }
  try {
    const p = (e && e.parameter) || {};
    if (p.website) return json_({ ok: true });                       // champ piège rempli : robot

    const prenom = clean_(p.prenom, 60), nom = clean_(p.nom, 60), ville = clean_(p.ville, 80);
    const email = clean_(p.email, 120).toLowerCase();
    const niveau = clean_(p.niveau, 40) || 'unknown';
    if (!prenom || !nom || ville.length < 2) return json_({ ok: false, erreur: 'champs' });
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return json_({ ok: false, erreur: 'email' });
    if (LEVELS.indexOf(niveau) === -1) return json_({ ok: false, erreur: 'niveau' });
    if (p.consent !== 'oui') return json_({ ok: false, erreur: 'consentement' });

    const sh = prospectsSheet_();
    const last = sh.getLastRow();
    const n = Math.max(0, last - 1);
    const data = n ? sh.getRange(2, 1, n, HEADERS.length).getValues() : [];

    // Doublon : même e-mail déjà enregistré -> on renvoie sa situation sans créer de ligne
    for (let i = 0; i < data.length; i++) {
      if (String(data[i][COL['E-mail'] - 1]).toLowerCase() === email) {
        return json_({
          ok: true, doublon: true,
          rang: Number(data[i][COL['Rang'] - 1]),
          admissible: data[i][COL['Statut offre'] - 1] === ST_OK,
          prises: countStatut_(data, ST_OK)
        });
      }
    }

    const prises = countStatut_(data, ST_OK);
    const admissible = prises < CONFIG.TOTAL_SEATS;
    let maxRang = 0;
    data.forEach(function (r) { const v = Number(r[COL['Rang'] - 1]); if (v > maxRang) maxRang = v; });
    const rang = maxRang + 1;

    const gclid = clean_(p.gclid, 120), fbclid = clean_(p.fbclid, 120);
    const source = clean_(p.utm_source, 80) || (gclid ? 'google' : fbclid ? 'facebook' : 'direct');
    const now = new Date();
    const id = Utilities.getUuid().slice(0, 8);

    const row = [
      id, now, rang, admissible ? ST_OK : ST_WAIT, prenom, nom, email, ville,
      source, clean_(p.utm_medium, 80), clean_(p.utm_campaign, 120), clean_(p.utm_content, 120), clean_(p.utm_term, 120),
      gclid, fbclid, clean_(p.page, 120), clean_(p.referrer, 200),
      'Oui, ' + dateFr_(now), 0, 'Nouveau', '', niveau === 'unknown' ? 'Je ne sais pas encore' : niveau
    ];
    sh.appendRow(row.map(safeCell_));

    const lead = { id: id, date: now, rang: rang, admissible: admissible, prenom: prenom, nom: nom, email: email, ville: ville, source: source };
    try { sendConfirmation_(lead); } catch (err) { console.error('Courriel de confirmation : ' + err); }
    try { notifyOwner_(lead, clean_(p.utm_campaign, 120)); } catch (err) { console.error('Alerte : ' + err); }

    return json_({ ok: true, rang: rang, admissible: admissible, prises: prises + (admissible ? 1 : 0) });
  } catch (err) {
    console.error(err);
    return json_({ ok: false, erreur: 'serveur' });
  } finally {
    lock.releaseLock();
  }
}

/* ================= RELANCES (déclencheur quotidien) ================= */

function envoyerRelances() {
  const sh = prospectsSheet_();
  const n = sh.getLastRow() - 1;
  if (n < 1) return;
  const data = sh.getRange(2, 1, n, HEADERS.length).getValues();
  const now = new Date().getTime();
  let envoyes = 0;
  for (let i = 0; i < data.length; i++) {
    const r = data[i];
    if (r[COL['Statut offre'] - 1] !== ST_OK) continue;                 // relances réservées aux 20 admissibles
    if (r[COL['Statut commercial'] - 1] !== 'Nouveau') continue;       // dès que vous changez le statut, les relances s'arrêtent
    const sent = Number(r[COL['Relances envoyées'] - 1]) || 0;
    if (sent >= CONFIG.FOLLOWUP_DAYS.length) continue;
    const created = r[COL['Date'] - 1];
    if (!created || typeof created.getTime !== 'function') continue;   // date illisible : on ignore la ligne
    const days = Math.floor((now - created.getTime()) / 86400000);
    if (days < CONFIG.FOLLOWUP_DAYS[sent]) continue;
    if (MailApp.getRemainingDailyQuota() < 5) break;
    const lead = { prenom: r[COL['Prénom'] - 1], email: r[COL['E-mail'] - 1], date: created };
    try {
      sendRelance_(lead, sent + 1);
      sh.getRange(i + 2, COL['Relances envoyées']).setValue(sent + 1);
      envoyes++;
    } catch (err) {
      console.error('Relance ' + lead.email + ' : ' + err);
    }
  }
  console.log(envoyes + ' relance(s) envoyée(s).');
}

/* ================= COURRIELS ================= */

function sendConfirmation_(lead) {
  const limite = dateFr_(new Date(lead.date.getTime() + CONFIG.OFFER_DAYS * 86400000));
  let subject, body;
  if (lead.admissible) {
    subject = 'Votre place est réservée : ' + CONFIG.DISCOUNT + ' de réduction';
    body = para_('Bonjour ' + esc_(lead.prenom) + ',')
      + para_('Bonne nouvelle : vous faites partie des <strong>' + CONFIG.TOTAL_SEATS + ' premiers inscrits</strong> à notre offre de lancement. '
        + 'Votre rabais de <strong>' + CONFIG.DISCOUNT + '</strong> est réservé jusqu\'au <strong>' + limite + '</strong>.')
      + para_('La suite est simple : nous échangeons quelques minutes pour comprendre votre objectif (test d\'allemand ou Ausbildung), évaluer votre niveau d\'allemand et choisir le bon cours.')
      + nextStep_();
  } else {
    subject = 'Vous êtes sur la liste d\'attente';
    body = para_('Bonjour ' + esc_(lead.prenom) + ',')
      + para_('Merci pour votre intérêt. Les ' + CONFIG.TOTAL_SEATS + ' places à ' + CONFIG.DISCOUNT + ' sont déjà prises, mais votre nom est sur la <strong>liste d\'attente</strong>.')
      + para_('Si l\'offre revient ou si une place se libère, vous serez parmi les premiers prévenus. Vous pouvez aussi répondre à ce courriel pour en savoir plus sur nos cours d\'allemand.');
  }
  mail_(lead.email, subject, body);
}

function sendRelance_(lead, numero) {
  const limite = dateFr_(new Date(lead.date.getTime() + CONFIG.OFFER_DAYS * 86400000));
  let subject, body;
  if (numero === 1) {
    subject = lead.prenom + ', votre rabais de ' + CONFIG.DISCOUNT + ' vous attend';
    body = para_('Bonjour ' + esc_(lead.prenom) + ',')
      + para_('Votre place à <strong>' + CONFIG.DISCOUNT + ' de réduction</strong> est toujours réservée. Il ne reste qu\'à choisir un moment pour en discuter.')
      + para_('Une question sur le déroulement des cours, les horaires, les tests d\'allemand ou l\'Ausbildung ? Répondez simplement à ce courriel.')
      + nextStep_();
  } else {
    subject = 'Dernier rappel : votre place est réservée jusqu\'au ' + limite;
    body = para_('Bonjour ' + esc_(lead.prenom) + ',')
      + para_('Petit rappel : votre rabais de <strong>' + CONFIG.DISCOUNT + '</strong> expire le <strong>' + limite + '</strong>. Passé cette date, la place retourne à la liste d\'attente.')
      + nextStep_();
  }
  mail_(lead.email, subject, body);
}

function notifyOwner_(lead, campagne) {
  if (!CONFIG.OWNER_EMAIL) return;
  MailApp.sendEmail({
    to: CONFIG.OWNER_EMAIL,
    subject: 'Nouveau prospect n° ' + lead.rang + ' (' + (lead.admissible ? ST_OK : ST_WAIT) + ')',
    body: lead.prenom + ' ' + lead.nom + '\n' + lead.email + '\n' + lead.ville + '\nSource : ' + lead.source + (campagne ? ' / ' + campagne : '')
  });
}

function nextStep_() {
  if (CONFIG.BOOKING_URL) {
    return '<p style="margin:22px 0"><a href="' + esc_(CONFIG.BOOKING_URL) + '" style="background:#FFB81F;color:#2B1D00;text-decoration:none;font-weight:700;padding:13px 22px;border-radius:10px;display:inline-block">Choisir un moment pour échanger</a></p>'
      + para_('Vous préférez écrire ? Répondez à ce courriel avec votre objectif (test d\'allemand ou Ausbildung), votre niveau actuel et vos disponibilités.');
  }
  return para_('<strong>Répondez simplement à ce courriel</strong> en nous indiquant votre objectif (test d\'allemand ou Ausbildung), votre niveau d\'allemand actuel et vos disponibilités.');
}

function mail_(to, subject, innerHtml) {
  const footer = '<p style="color:#6B7B91;font-size:12px;line-height:1.5;margin-top:28px;border-top:1px solid #E1E8F0;padding-top:14px">'
    + esc_(CONFIG.SCHOOL_NAME) + (CONFIG.SENDER_ADDRESS ? ' · ' + esc_(CONFIG.SENDER_ADDRESS) : '') + '<br>'
    + 'Vous recevez ce courriel parce que vous avez rempli notre formulaire. Pour ne plus rien recevoir, répondez STOP à ce message.</p>';
  const html = '<div style="font-family:Arial,Helvetica,sans-serif;font-size:16px;line-height:1.6;color:#0E2038;max-width:560px;margin:0 auto;padding:8px">'
    + '<p style="font-weight:700;font-size:18px;margin:0 0 18px">' + esc_(CONFIG.SCHOOL_NAME) + '</p>' + innerHtml + footer + '</div>';
  const opts = { to: to, subject: subject, htmlBody: html, name: CONFIG.SCHOOL_NAME };
  if (CONFIG.REPLY_TO) opts.replyTo = CONFIG.REPLY_TO;
  MailApp.sendEmail(opts);
}

function para_(html) { return '<p style="margin:0 0 14px">' + html + '</p>'; }

/* ================= INSTALLATION (à lancer une seule fois) ================= */

function setup() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  ss.setSpreadsheetTimeZone(CONFIG.TIMEZONE);
  const sep = formulaSeparator_(ss);

  const sh = ss.getSheetByName(SHEET_PROSPECTS) || ss.insertSheet(SHEET_PROSPECTS);
  sh.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS])
    .setFontWeight('bold').setBackground('#0A1A2E').setFontColor('#FFFFFF');
  sh.setFrozenRows(1);
  sh.getRange(2, COL['Date'], 2000, 1).setNumberFormat('yyyy-mm-dd hh:mm');
  const widths = { 'ID': 80, 'Date': 130, 'Rang': 55, 'Statut offre': 110, 'Prénom': 110, 'Nom': 110, 'E-mail': 220, 'Ville': 120, 'Statut commercial': 170, 'Notes': 260, 'Niveau': 130 };
  Object.keys(widths).forEach(function (h) { sh.setColumnWidth(COL[h], widths[h]); });
  const valid = SpreadsheetApp.newDataValidation().requireValueInList(COMMERCIAL, true).setAllowInvalid(false).build();
  sh.getRange(2, COL['Statut commercial'], 2000, 1).setDataValidation(valid);
  const ok = SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo(ST_OK).setBackground('#D9F2E3')
    .setRanges([sh.getRange(2, COL['Statut offre'], 2000, 1)]).build();
  const wait = SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo(ST_WAIT).setBackground('#FFF1CC')
    .setRanges([sh.getRange(2, COL['Statut offre'], 2000, 1)]).build();
  sh.setConditionalFormatRules([ok, wait]);

  // Les 20 premiers : liste filtrée automatiquement
  const top = ss.getSheetByName(SHEET_TOP) || ss.insertSheet(SHEET_TOP);
  top.clear();
  top.getRange(1, 1, 1, 8).setValues([HEADERS.slice(0, 8)]).setFontWeight('bold').setBackground('#0C7C7A').setFontColor('#FFFFFF');
  top.getRange('A2').setFormula('=IFERROR(FILTER(' + SHEET_PROSPECTS + '!A2:H' + sep + ' ' + SHEET_PROSPECTS + '!D2:D="' + ST_OK + '")' + sep + ' "")');
  top.setFrozenRows(1);
  top.getRange('B2:B').setNumberFormat('yyyy-mm-dd hh:mm');
  top.setColumnWidth(7, 220);

  // Tableau de bord
  const d = ss.getSheetByName(SHEET_DASH) || ss.insertSheet(SHEET_DASH, 0);
  d.clear();
  const P = SHEET_PROSPECTS + '!';
  d.getRange('A1').setValue('Campagne : suivi des prospects').setFontSize(16).setFontWeight('bold');
  const kpis = [
    ['Demandes reçues', '=COUNTA(' + P + 'A2:A)'],
    ['Admissibles à l\'offre', '=COUNTIF(' + P + 'D2:D' + sep + '"' + ST_OK + '")'],
    ['Places restantes', '=MAX(0' + sep + CONFIG.TOTAL_SEATS + '-B4)'],
    ['Liste d\'attente', '=COUNTIF(' + P + 'D2:D' + sep + '"' + ST_WAIT + '")'],
    ['À contacter (Nouveau)', '=COUNTIF(' + P + 'T2:T' + sep + '"Nouveau")'],
    ['Inscrits', '=COUNTIF(' + P + 'T2:T' + sep + '"Inscrit")'],
    ['Taux d\'inscription', '=IFERROR(B8/B3' + sep + '0)']
  ];
  kpis.forEach(function (k, i) {
    d.getRange(3 + i, 1).setValue(k[0]);
    d.getRange(3 + i, 2).setFormula(k[1]).setFontWeight('bold').setFontSize(13);
  });
  d.getRange('B9').setNumberFormat('0.0%');
  d.getRange('A12').setValue('Demandes par source').setFontWeight('bold');
  d.getRange('D12').setValue('Demandes par jour').setFontWeight('bold');
  d.getRange('G12').setValue('Demandes par campagne').setFontWeight('bold');
  const base = P + 'A1:U';
  d.getRange('A13').setFormula('=IFERROR(QUERY(' + base + sep + '"select I, count(A) where A is not null group by I label I \'Source\', count(A) \'Demandes\'"' + sep + ' 1)' + sep + '"Aucune donnée")');
  d.getRange('D13').setFormula('=IFERROR(QUERY(' + base + sep + '"select toDate(B), count(A) where A is not null group by toDate(B) order by toDate(B) desc label toDate(B) \'Jour\', count(A) \'Demandes\'"' + sep + ' 1)' + sep + '"Aucune donnée")');
  d.getRange('G13').setFormula('=IFERROR(QUERY(' + base + sep + '"select K, count(A) where A is not null group by K label K \'Campagne\', count(A) \'Demandes\'"' + sep + ' 1)' + sep + '"Aucune donnée")');
  d.setColumnWidth(1, 230);
  d.setColumnWidth(4, 120);
  d.setColumnWidth(7, 200);

  const vide = ss.getSheetByName('Feuille 1') || ss.getSheetByName('Sheet1');
  if (vide && vide.getLastRow() === 0 && ss.getSheets().length > 1) ss.deleteSheet(vide);

  // Relances automatiques tous les jours à 9 h
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'envoyerRelances') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('envoyerRelances').timeBased().everyDays(1).atHour(9).create();
}

/* ================= OUTILS ================= */

function prospectsSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = ss.getSheetByName(SHEET_PROSPECTS);
  if (!sh) throw new Error('Feuille « Prospects » introuvable : lancez setup() une fois.');
  return sh;
}

function formulaSeparator_(ss) {
  return String(ss.getSpreadsheetLocale()).toLowerCase().startsWith('en') ? ',' : ';';
}

function stats_() {
  const sh = prospectsSheet_();
  const n = Math.max(0, sh.getLastRow() - 1);
  const data = n ? sh.getRange(2, 1, n, HEADERS.length).getValues() : [];
  return { admissibles: Math.min(countStatut_(data, ST_OK), CONFIG.TOTAL_SEATS), demandes: data.length };
}

function countStatut_(data, statut) {
  let c = 0;
  data.forEach(function (r) { if (r[COL['Statut offre'] - 1] === statut) c++; });
  return c;
}

function clean_(v, max) {
  return String(v == null ? '' : v).replace(/[\u0000-\u001F\u007F]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max || 100);
}

function safeCell_(v) {                          // empêche l'injection de formules dans Sheets
  return (typeof v === 'string' && /^[=+\-@]/.test(v)) ? "'" + v : v;
}

function esc_(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function dateFr_(d) {
  const mois = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
  return d.getDate() + ' ' + mois[d.getMonth()] + ' ' + d.getFullYear();
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
