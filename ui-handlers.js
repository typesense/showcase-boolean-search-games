// UI event handlers and rendering logic

const { autocomplete } = window['@algolia/autocomplete-js'];

// Extracts the display value for an autocomplete item
window.getDisplayValue = function(item, state) {
  return item._value;
};

// Setup enter key handler for autocomplete input
window.setupEnterKeyHandler = function() {
  setTimeout(() => {
    const autocompleteContainer = document.getElementById('autocomplete');
    const autocompleteInput = autocompleteContainer?.querySelector('input[type="search"], input[type="text"]');
    if (autocompleteInput) {
      autocompleteInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.isComposing) {
          const query = autocompleteInput.value?.trim();
          if (query) {
            const panel = document.querySelector('.aa-Panel');
            const isPanelOpen = panel && panel.offsetParent !== null;
            const activeItem = panel ? panel.querySelector('.aa-Item[aria-selected="true"]') : null;
            
            if (activeItem && isPanelOpen) {
              return;
            }
            
            e.preventDefault();
            window.addTag(query, undefined);
            autocompleteInput.value = '';
            if (panel) {
              panel.style.display = 'none';
            }
          }
        }
      });
    }
  }, 100);
};

// Add tag to our tags array, and render the tags UI
window.addTag = function(value, fieldType) {
  const trimmed = value?.trim();
  if (!trimmed || window.tags.some(t => t.value === trimmed && t.fieldType === fieldType)) return;
  window.tags.push({ 
    id: `tag-${window.tagIdCounter++}`, 
    value: trimmed, 
    fieldType,
    excludeChecked: false
  });
  window.renderTags();
  window.updateGuidingText(); // Update the guiding text to show the user what to try next
  window.loadResults();
};

window.renderTags = function() {
  const container = document.getElementById('tags-container');
  if (!container) return;
  
  const tagsByType = {};
  window.tags.forEach(tag => {
    const key = tag.fieldType ?? 'undefined';
    if (!tagsByType[key]) {
      tagsByType[key] = [];
    }
    tagsByType[key].push(tag);
  });
  
  //Template for the tags UI
  container.innerHTML = Object.entries(tagsByType).map(([fieldType, typeTags]) => {
    const typeLabel = fieldType === 'undefined' ? 'all fields' : window.fieldLabels[fieldType];
    const tagValues = typeTags.map(tag => `
      <span class="tag-value-item">
        <span class="tag-value">${tag.value}</span>
        <input type="checkbox" class="tag-checkbox tag-checkbox-exclude" data-id="${tag.id}" ${tag.excludeChecked ? 'checked' : ''} />
      </span>
    `).join('');
    
    const andOrSwitch = fieldType === 'genres' ? `
      <button class="tag-andor-switch" title="${window.genresUseAnd ? 'Switch to OR' : 'Switch to AND'}" data-field-type="${fieldType}">
        <span class="tag-andor-option ${!window.genresUseAnd ? 'active' : ''}">OR</span>
        <span class="tag-andor-option ${window.genresUseAnd ? 'active' : ''}">AND</span>
      </button>
    ` : fieldType === 'supportedOperatingSystems' ? `
      <button class="tag-andor-switch" title="${window.supportedOperatingSystemsUseAnd ? 'Switch to OR' : 'Switch to AND'}" data-field-type="${fieldType}">
        <span class="tag-andor-option ${!window.supportedOperatingSystemsUseAnd ? 'active' : ''}">OR</span>
        <span class="tag-andor-option ${window.supportedOperatingSystemsUseAnd ? 'active' : ''}">AND</span>
      </button>
    ` : '';
    
    return `
      <span class="tag">
        <span class="tag-type">${typeLabel}</span>
        ${tagValues}
        ${andOrSwitch}
        <button class="tag-remove" data-field-type="${fieldType}">×</button>
      </span>
    `;
  }).join('');
  
  container.querySelectorAll('.tag-checkbox-exclude').forEach(checkbox => {
    checkbox.onchange = (e) => window.handleExcludeChange(checkbox.dataset.id, e.target.checked);
  });
  
  container.querySelectorAll('.tag-andor-switch').forEach(btn => {
    btn.onclick = () => window.handleAndOrToggle(btn.dataset.fieldType);
  });
  
  container.querySelectorAll('.tag-remove').forEach(btn => {
    btn.onclick = () => window.removeTagsByType(btn.dataset.fieldType);
  });
};

window.handleAndOrToggle = function(fieldType) {
  if (fieldType === 'genres') {
    window.genresUseAnd = !window.genresUseAnd;
  } else if (fieldType === 'supportedOperatingSystems') {
    window.supportedOperatingSystemsUseAnd = !window.supportedOperatingSystemsUseAnd;
  }
  window.renderTags();
  window.loadResults();
};

// Handle the change of the exclude checkbox for a tag
window.handleExcludeChange = function(tagId, checked) {
  const tag = window.tags.find(t => t.id === tagId);
  if (!tag) return;
  
  tag.excludeChecked = checked;
  
  window.renderTags();
  window.updateGuidingText();
  window.loadResults();
};

window.removeTag = function(id) {
  window.tags = window.tags.filter(t => t.id !== id);
  window.renderTags();
  window.updateGuidingText();
  window.tags.length ? window.loadResults() : window.clearResults();
};

// Remove tags all tags of a set type, and update the guiding text
window.removeTagsByType = function(fieldType) {
  window.tags = window.tags.filter(t => {
    if (fieldType === 'undefined') {
      return t.fieldType !== undefined && t.fieldType !== null;
    } else {
      return t.fieldType !== fieldType;
    }
  });
  window.renderTags();
  window.updateGuidingText();
  window.tags.length ? window.loadResults() : window.clearResults();
};

window.formatGame = function(doc) {
  const genres = Array.isArray(doc.genres) ? doc.genres.join(', ') : 'N/A';
  const os = Array.isArray(doc.supportedOperatingSystems) ? doc.supportedOperatingSystems.join(', ') : 'N/A';
  const price = doc.amount ? `$${doc.amount.toFixed(2)}` : 'N/A';
  const year = doc.releaseDate ? new Date(doc.releaseDate * 1000).getFullYear() : 'N/A';
  
  return `
    <div class="result-item">
      <div class="game-title">${doc.title || 'Unknown'}</div>
      <div class="game-details">
        Developer: ${doc.developer || 'N/A'} | Publisher: ${doc.publisher || 'N/A'} | 
        Genres: ${genres} | OS: ${os} | Price: ${price} | Year: ${year}
      </div>
    </div>
  `;
};

window.renderPagination = function(page, totalResults) {
  const totalPages = Math.ceil(totalResults / window.resultsPerPage);
  if (totalPages <= 1) {
    return `<div class="results-info">Found ${totalResults} result${totalResults !== 1 ? 's' : ''}</div>`;
  }
  
  const startIdx = (page - 1) * window.resultsPerPage;
  const endIdx = Math.min(startIdx + window.resultsPerPage, totalResults);
  
  const pageButtons = Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
    const pageNum = Math.max(1, Math.min(totalPages - 4, page - 2)) + i;
    return `<button class="page-btn ${pageNum === page ? 'active' : ''}" onclick="loadResults(${pageNum})">${pageNum}</button>`;
  }).join('');
  
  const prevButton = page > 1 ? `<button class="page-btn" onclick="loadResults(${page - 1})">Previous</button>` : '';
  const nextButton = page < totalPages ? `<button class="page-btn" onclick="loadResults(${page + 1})">Next</button>` : '';
  
  return `
    <div class="pagination">
      ${prevButton}
      ${pageButtons}
      ${nextButton}
    </div>
    <div class="results-info">Showing ${startIdx + 1}-${endIdx} of ${totalResults}</div>
  `;
};

window.loadResults = async function(page = 1) {
  if (!window.tags.length) return window.clearResults();
  
  window.currentPage = page;
  const queries = window.generateSearchQueries(window.tags);
  
  const list = document.getElementById('results-list');
  const pagination = document.getElementById('results-pagination');
  if (!list || !pagination) {
    setTimeout(() => window.loadResults(page), 100);
    return;
  }
  
  list.innerHTML = '<div class="loading">Loading...</div>';
  
  try {
    // Union the results for when multiple all-fields tags are present, and remove duplicates
    const result = await window.typesenseClient.multiSearch.perform({
      union: true,
      remove_duplicates: true,
      searches: queries,
    }, {
      page,
      per_page: window.resultsPerPage,
    });
    
    const hits = result.hits || [];
    window.totalResults = result.found || 0;
    
    if (hits.length) {
      list.innerHTML = hits.map(hit => window.formatGame(hit.document)).join('');
      pagination.innerHTML = window.renderPagination(page, window.totalResults);
    } else {
      list.innerHTML = '<div class="no-results">No results</div>';
      pagination.innerHTML = '';
    }
  } catch (error) {
    list.innerHTML = '<div class="error">Error loading results</div>';
    pagination.innerHTML = '';
  }
};

window.clearResults = function() {
  const list = document.getElementById('results-list');
  const pagination = document.getElementById('results-pagination');
  if (list) list.innerHTML = '';
  if (pagination) pagination.innerHTML = '';
  window.currentPage = 1;
  window.totalResults = 0;
};

// Setup autocomplete
autocomplete({
  container: '#autocomplete',
  placeholder: 'Start typing to find tags for title, genre, developer ...',
  detachedMediaQuery: 'none',
  openOnFocus: false,
  async getSources({ query }) {
    if (!query?.trim()) {
      window.pendingGuideLinkField = null; // Used by the guide links (Try: Electronic Arts, etc)
      return [];
    }
    
    const results = await window.debouncedSearch(query);
    
    if (!results) return [];
    
    return [{
      sourceId: 'predictions',
      getItems() {
        const seen = new Set();
        const byCategory = {};
        const queryLower = query.toLowerCase();
        
        results.hits.forEach(hit => {
          // Helper functions defined below.
          window.collectArrayMatches(hit, query, 'genres', byCategory, seen, 3);
          window.collectArrayMatches(hit, query, 'supportedOperatingSystems', byCategory, seen, 3);
          window.collectFieldMatches(hit, query, byCategory, seen);
        });
        
        const items = window.fieldPriority
          .filter(fieldType => byCategory[fieldType])
          .flatMap(fieldType => byCategory[fieldType]);
        
        // Adding guide link text when the user clicks on "Try: ..." suggestion tags
        if (window.pendingGuideLinkField !== null) {
          const fieldType = window.pendingGuideLinkField;
          const fieldLabel = fieldType === undefined ? 'all fields' : window.fieldLabels[fieldType];
          items.unshift({ 
            isGuideLinkTag: true, 
            query, 
            fieldType,
            label: `${query} - Click to add ${fieldLabel} tag`,
            queryValue: query,
            clickToAddText: `Click to add ${fieldLabel} tag`
          });
          
          // Removing the actual retrieved completion from the list, so that it isnt a duplicate of the completion added above
          const itemsToRemove = [];
          items.forEach((item, index) => {
            if (index === 0 || item.isGuideLinkTag) return;
            
            const itemFieldType = item._fieldType || window.determineFieldType(item, query);
            if (itemFieldType === fieldType) {
              let itemValue = item._value;
              if (!itemValue) {
                if (itemFieldType === 'genres' || itemFieldType === 'supportedOperatingSystems') {
                  itemValue = window.getArrayValue(item.document, item.highlights, itemFieldType, query);
                } else {
                  itemValue = window.getFieldValue(item.document, item.highlights, itemFieldType);
                }
              }
              if (itemValue && String(itemValue).toLowerCase().trim() === queryLower) {
                itemsToRemove.push(index);
              }
            }
          });
          
          itemsToRemove.reverse().forEach(index => items.splice(index, 1));
        } else if (query?.trim() && !window.tags.some(t => t.value.toLowerCase() === queryLower)) {
          items.push({ isUndefinedTag: true, query });
        }
        
        return items;
      },
      onSelect({ item, state }) {
        if (item.isGuideLinkTag) {
          window.addTag(item.query || state.query, item.fieldType);
          window.pendingGuideLinkField = null;
          state.setQuery('');
          return;
        }
        
        if (item.isUndefinedTag) {
          window.addTag(item.query || state.query, undefined);
          window.pendingGuideLinkField = null;
          state.setQuery('');
          return;
        }
        
        // For regular autocomplete items: determines field type, extracts value from document/highlights 
        // (using getArrayValue for array fields, getFieldValue for strings), then adds the tag and clears the input
        const fieldType = item._fieldType || window.determineFieldType(item, state.query);
        let value = item._value;
        if (!value) {
          if (fieldType === 'genres' || fieldType === 'supportedOperatingSystems') {
            value = window.getArrayValue(item.document, item.highlights, fieldType, state.query);
          } else {
            value = window.getFieldValue(item.document, item.highlights, fieldType);
          }
        }
        
        if (value?.trim()) {
          window.addTag(String(value).trim(), fieldType);
        }
        window.pendingGuideLinkField = null;
        state.setQuery('');
      },
      getItemInputValue: () => '',
      // HTML templates for the autocomplete suggestions list
      templates: {
        item({ item, html, state }) {
          if (item.isGuideLinkTag) {
            const fieldType = item.fieldType;
            const fieldLabel = fieldType === undefined ? 'all fields' : window.fieldLabels[fieldType];
            return html`<div class="suggestion-item">
              <span class="suggestion-value">${item.queryValue} - <span class="click-to-add-text">${item.clickToAddText}</span></span>
              <span class="field-badge field-${fieldType || 'undefined'}">${fieldLabel}</span>
            </div>`;
          }
          
          if (item.isUndefinedTag) {
            return html`<div class="suggestion-item">
              <span class="suggestion-value">${state.query}</span>
              <span class="field-badge">all fields</span>
            </div>`;
          }
          
          const fieldType = item._fieldType || window.determineFieldType(item, state.query);
          const value = window.getDisplayValue(item, state);
          
          if (!value?.trim()) {
            return html`<div style="display: none;"></div>`;
          }
          
          return html`<div class="suggestion-item">
            <span class="suggestion-value" dangerouslySetInnerHTML=${{ __html: value }}></span>
            <span class="field-badge field-${fieldType}">${window.fieldLabels[fieldType]}</span>
          </div>`;
        },
        noResults({ state, html }) {
          if (state.query?.trim()) {
            return html`<div class="suggestion-item">
              <span class="suggestion-value">Search "${state.query}" in all fields</span>
              <span class="field-badge">all fields</span>
            </div>`;
          }
          return 'No results found.';
        },
      },
    }];
  },
});

