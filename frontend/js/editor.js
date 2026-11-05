// editor.js - the Species record editor page.

drawMenu('editor.html');

let editIndex = -1;
let photo = PICTURE_BLANK;
let firstDate = '';
let firstWhen = '';
let obsId = '';
let reader = null;
let origSci = '';
let origLoc = '';
let origGps = '';

// Botanists do not change the catalogue directly. Their work goes to the approval queue.
const me = getCurrentUser();
const isBotanistUser = (me !== null && isBotanist(me));

// Shows the current photo in the preview box.
function showPhoto() {
  const preview = document.getElementById('photo-preview');
  preview.innerHTML = '';
  preview.appendChild(makeThumb(photo, 'Species photo'));
}

// Fills the form when the page opens: with the species to edit, or empty boxes for a new species.
function startEditor() {
  let wanted = readStorage(EDIT_KEY);
  if (wanted === null) {
    wanted = -1;
  }
  writeStorage(EDIT_KEY, -1);

  const list = getSpecies();
  if (wanted >= 0 && wanted < list.length) {
    editIndex = wanted;
    const species = list[wanted];
    document.getElementById('editor-title').innerHTML = 'Edit <span>species record</span>';
    document.getElementById('f-sci').value = species.sci;
    document.getElementById('f-com').value = species.com;
    document.getElementById('f-fam').value = species.fam;
    document.getElementById('f-status').value = species.status;
    document.getElementById('f-loc').value = species.loc;
    document.getElementById('f-gps').value = species.gps;
    document.getElementById('f-desc').value = species.desc;
    photo = species.photo;
    firstDate = species.firstDate;
    firstWhen = species.firstWhen;
    obsId = species.obsId || '';
    origSci = species.sci;
    origLoc = species.loc;
    origGps = species.gps;
  } else {
    editIndex = -1;
    document.getElementById('editor-title').innerHTML = 'Add <span>species record</span>';
    document.getElementById('f-status').value = 'Least Concern';
    photo = PICTURE_BLANK;
    firstDate = '';
    firstWhen = '';
    obsId = '';
  }
  if (isBotanistUser) {
    document.getElementById('approval-note').hidden = false;
    document.getElementById('save-button').textContent = 'Send for approval';
  }
  showPhoto();
}

// Says if the species has a real photo of the plant (an uploaded picture or a picture link),
// not one of the default pictures.
function hasRealPhoto() {
  if (photo.indexOf('https://') === 0) {
    return true;
  }
  return photo.indexOf('data:image/') === 0 && photo.indexOf('data:image/svg+xml') !== 0;
}

// Makes a photo smaller (at most 900 pixels wide or high), so big pictures still save quickly.
// done is called with the smaller picture, or with null when the file is not a picture.
function shrinkPhoto(pictureText, done) {
  const image = new Image();
  image.onload = function () {
    const biggest = Math.max(image.width, image.height);
    let scale = 1;
    if (biggest > 900) {
      scale = 900 / biggest;
    }
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(image.width * scale);
    canvas.height = Math.round(image.height * scale);
    const pen = canvas.getContext('2d');
    pen.fillStyle = '#ffffff';
    pen.fillRect(0, 0, canvas.width, canvas.height);
    pen.drawImage(image, 0, 0, canvas.width, canvas.height);
    done(canvas.toDataURL('image/jpeg', 0.8));
  };
  image.onerror = function () {
    done(null);
  };
  image.src = pictureText;
}

// Runs when the chosen photo file has been read. Makes it smaller, keeps it and shows it in the preview.
function photoIsRead() {
  shrinkPhoto(reader.result, function (smallPhoto) {
    if (smallPhoto === null) {
      showToast('That file is not a picture. Choose a JPG or PNG image.');
      return;
    }
    photo = smallPhoto;
    showPhoto();
  });
}

// Starts reading the photo the user chose. Called when the file picker changes.
function previewPhoto(input) {
  const file = input.files[0];
  if (!file) {
    return;
  }
  reader = new FileReader();
  reader.onload = photoIsRead;
  reader.readAsDataURL(file);
}

// Says if the form is the same as the record the botanist opened.
function formIsUnchanged() {
  const old = getSpecies()[editIndex];
  return old.sci === document.getElementById('f-sci').value.trim() &&
    old.com === document.getElementById('f-com').value.trim() &&
    old.fam === document.getElementById('f-fam').value.trim() &&
    old.status === document.getElementById('f-status').value &&
    old.loc === document.getElementById('f-loc').value.trim() &&
    old.gps === document.getElementById('f-gps').value.trim() &&
    old.desc === document.getElementById('f-desc').value.trim() &&
    old.photo === photo;
}

// For botanists: saves the new species or the edit as a Pending observation, then goes back to the catalogue page.
// The conservation officer approves or rejects it in the Observation approval queue.
function sendForApproval(sci) {
  if (editIndex !== -1 && formIsUnchanged()) {
    showToast('You have not changed anything');
    return;
  }

  const now = new Date();
  const list = getObservations();
  let kind = 'new';
  if (editIndex !== -1) {
    kind = 'edit';
  }

  list.push({
    id: nextObservationId(list),
    kind: kind,
    sci: sci,
    com: document.getElementById('f-com').value.trim(),
    fam: document.getElementById('f-fam').value.trim(),
    status: document.getElementById('f-status').value,
    by: me.name,
    date: isoDate(now),
    when: whenText(now),
    loc: document.getElementById('f-loc').value.trim(),
    gps: document.getElementById('f-gps').value.trim(),
    notes: document.getElementById('f-desc').value.trim(),
    photo: photo,
    origSci: origSci,
    origLoc: origLoc,
    origGps: origGps,
    state: 'Pending',
    reason: ''
  });

  if (writeStorage(OBSERVATIONS_KEY, list) === false) {
    return;
  }

  rememberToast('Sent to the Observation approval queue for review');
  location.href = 'species.html';
}

// Checks the form, saves the species (new or edited), then goes back to the catalogue page.
function saveSpecies() {
  const sci = document.getElementById('f-sci').value.trim();
  if (sci === '') {
    showToast('Enter a scientific name');
    return;
  }
  if (hasRealPhoto() === false) {
    showToast('Please upload an image of the plant.');
    return;
  }

  if (isBotanistUser) {
    sendForApproval(sci);
    return;
  }

  const now = new Date();
  const species = {
    sci: sci,
    com: document.getElementById('f-com').value.trim(),
    fam: document.getElementById('f-fam').value.trim(),
    status: document.getElementById('f-status').value,
    loc: document.getElementById('f-loc').value.trim(),
    gps: document.getElementById('f-gps').value.trim(),
    desc: document.getElementById('f-desc').value.trim(),
    photo: photo,
    date: isoDate(now),
    when: whenText(now),
    firstDate: firstDate,
    firstWhen: firstWhen,
    obsId: obsId
  };
  if (editIndex === -1) {
    species.firstDate = isoDate(now);
    species.firstWhen = whenText(now);
  }

  const list = getSpecies();
  if (editIndex === -1) {
    list.push(species);
  } else {
    list[editIndex] = species;
  }

  const worked = writeStorage(SPECIES_KEY, list);
  if (worked === false) {
    return;
  }

  rememberToast('Species saved');
  location.href = 'species.html';
}

startEditor();
