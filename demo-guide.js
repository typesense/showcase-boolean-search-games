// Demo guide text and link handling

window.updateGuidingText = function() {
  const guidingText = document.getElementById('guiding-text');
  if (!guidingText) return;
  
  const guideTags = [
    { value: 'Electronic Arts', fieldType: 'publisher' },
    { value: 'Role-playing', fieldType: 'genres' },
    { value: 'THQ Nordic GmbH', fieldType: 'publisher' },
    { value: 'Action', fieldType: 'genres' },
    { value: 'Dark', fieldType: undefined },
    { value: '2', fieldType: undefined }
  ];
  
  const hasElectronicArts = window.tags.some(t => t.value === 'Electronic Arts' && t.fieldType === 'publisher');
  const hasRolePlaying = window.tags.some(t => t.value === 'Role-playing' && t.fieldType === 'genres');
  const hasTHQNordic = window.tags.some(t => t.value === 'THQ Nordic GmbH' && t.fieldType === 'publisher');
  const hasAction = window.tags.some(t => t.value === 'Action' && t.fieldType === 'genres');
  const hasDark = window.tags.some(t => t.value === 'Dark' && t.fieldType === undefined);
  const has2 = window.tags.some(t => t.value === '2' && t.fieldType === undefined);
  
  const allGuideTagsPresent = hasElectronicArts && hasRolePlaying && hasTHQNordic && hasAction && hasDark && has2;
  
  const hasOtherTags = window.tags.some(t => {
    return !guideTags.some(gt => gt.value === t.value && gt.fieldType === t.fieldType);
  });
  
  if (allGuideTagsPresent || hasOtherTags) {
    guidingText.style.display = 'none';
    return;
  }
  
  guidingText.style.display = '';
  
  let stage1Links, stage2Links, stage3Links, stage4Links;
  
  //  State machine for the guiding text, based on the tags present
  if (hasElectronicArts && hasTHQNordic && hasAction && hasRolePlaying) {
    if (!hasDark && !has2) {
      stage4Links = `
        <a href="#" class="guide-link" data-value="Dark" data-field="undefined">Dark</a>
        <span> & </span>
        <a href="#" class="guide-link" data-value="2" data-field="undefined">2</a>
      `;
      guidingText.innerHTML = `<span>Try: </span>${stage4Links}`;
    } else if (!hasDark && has2) {
      stage4Links = `
        <a href="#" class="guide-link" data-value="Dark" data-field="undefined">Dark</a>
      `;
      guidingText.innerHTML = `<span>Try: </span>${stage4Links}`;
    } else if (hasDark && !has2) {
      stage4Links = `
        <a href="#" class="guide-link" data-value="2" data-field="undefined">2</a>
      `;
      guidingText.innerHTML = `<span>Try: </span>${stage4Links}`;
    }
  } else if (hasElectronicArts && (hasAction || hasRolePlaying)) {
    const hasOneGenre = (hasAction && !hasRolePlaying) || (!hasAction && hasRolePlaying);
    const hasBothGenres = hasAction && hasRolePlaying;
    
    if (!hasTHQNordic && hasOneGenre) {
      const remainingGenre = hasAction ? 'Role-playing' : 'Action';
      stage3Links = `
        <a href="#" class="guide-link" data-value="THQ Nordic GmbH" data-field="publisher">THQ Nordic</a>
        <span> & </span>
        <a href="#" class="guide-link" data-value="${remainingGenre}" data-field="genres">${remainingGenre}</a>
      `;
      guidingText.innerHTML = `<span>Try: </span>${stage3Links}`;
    } else if (!hasTHQNordic && hasBothGenres) {
      stage3Links = `
        <a href="#" class="guide-link" data-value="THQ Nordic GmbH" data-field="publisher">THQ Nordic</a>
      `;
      guidingText.innerHTML = `<span>Try: </span>${stage3Links}`;
    } else if (hasTHQNordic && hasOneGenre) {
      const remainingGenre = hasAction ? 'Role-playing' : 'Action';
      stage3Links = `
        <a href="#" class="guide-link" data-value="${remainingGenre}" data-field="genres">${remainingGenre}</a>
      `;
      guidingText.innerHTML = `<span>Try: </span>${stage3Links}`;
    } else {
      stage2Links = `
        <a href="#" class="guide-link" data-value="Action" data-field="genres">Action</a>
        <span> or </span>
        <a href="#" class="guide-link" data-value="Role-playing" data-field="genres">Role-playing</a>
      `;
      guidingText.innerHTML = `<span>Try: </span>${stage2Links}`;
    }
  } else if (hasElectronicArts) {
    stage2Links = `
      <a href="#" class="guide-link" data-value="Action" data-field="genres">Action</a>
      <span> or </span>
      <a href="#" class="guide-link" data-value="Role-playing" data-field="genres">Role-playing</a>
    `;
    guidingText.innerHTML = `<span>Try: </span>${stage2Links}`;
  } else {
    stage1Links = `
      <a href="#" class="guide-link" data-value="Electronic Arts" data-field="publisher">Electronic Arts</a>
    `;
    guidingText.innerHTML = `<span>Try: </span>${stage1Links}`;
  }
  
  // Add the guide links to the autocomplete input when the user clicks on them
  const autocompleteContainer = document.getElementById('autocomplete');
  guidingText.querySelectorAll('.guide-link').forEach(link => {
    link.onclick = (e) => {
      e.preventDefault();
      const value = link.dataset.value;
      const field = link.dataset.field === 'undefined' ? undefined : link.dataset.field;
      window.pendingGuideLinkField = field;
      const autocompleteInput = autocompleteContainer?.querySelector('input[type="search"], input[type="text"]');
      if (autocompleteInput) {
        autocompleteInput.value = value;
        autocompleteInput.focus();
        autocompleteInput.dispatchEvent(new Event('input', { bubbles: true }));
      }
    };
  });
};

