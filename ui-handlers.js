// UI event handlers and rendering logic

const { autocomplete } = window['@algolia/autocomplete-js'];

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
            window.addTag(query, 'undefined');
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
  window.pendingGuideLinkField = null; // Reset guide link field after adding tag
  window.renderTags();
  window.updateGuidingText(); // Update the guiding text to show the user what to try next
  window.loadResults();
};

window.renderTags = function() {
  const container = document.getElementById('tags-container');
  if (!container) return;
  
  const tagsByType = {};
  window.tags.forEach(tag => {
    const key = tag.fieldType || 'undefined';
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
    return t.fieldType !== fieldType;
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
        const byCategory = {}; // Dict to group suggestions by field type for sorting & limiting the number of tags of the same type.
        const queryLower = query.toLowerCase();
        
        results.hits.forEach(hit => {
          // Helper functions defined below.
          window.collectArrayMatches(hit, query, 'genres', byCategory, seen, 3);
          window.collectArrayMatches(hit, query, 'supportedOperatingSystems', byCategory, seen, 3);
          window.collectFieldMatches(hit, query, byCategory, seen);
        });
        
        const items = window.fieldPriority // Sort by fieldPriority for better UX 
          .filter(fieldType => byCategory[fieldType])
          .flatMap(fieldType => byCategory[fieldType]);
        
        // Adding guide link text when the user clicks on "Try: ..." suggestion tags
        // Check explicitly for null (not undefined) since guide links can set it to undefined (the value)
        if (window.pendingGuideLinkField !== null) {
          const fieldType = window.pendingGuideLinkField === undefined ? 'undefined' : (window.pendingGuideLinkField || 'undefined');
          const fieldLabel = fieldType === 'undefined' ? 'all fields' : window.fieldLabels[fieldType];
          items.unshift({ 
            isGuideLinkTag: true, 
            _fieldType: fieldType,
            _value: query,
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
            
            const itemFieldType = item._fieldType;
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
        }
        
        // Always check for undefined suggestion, regardless of pendingGuideLinkField
        if (query?.trim() && !window.tags.some(t => t.value.toLowerCase() === queryLower && t.fieldType === 'undefined')) {
          // Only add undefined suggestion if we don't already have a guide link tag for this exact query
          const hasGuideLinkForQuery = items.some(item => 
            item.isGuideLinkTag && 
            item._fieldType === 'undefined' && 
            item._value?.toLowerCase() === queryLower
          );
          if (!hasGuideLinkForQuery) {
            items.push({ _fieldType: 'undefined', _value: query, query });
          }
        }
        
        return items;
      },
      onSelect({ item, state }) {
        if (item.isGuideLinkTag) {
          window.addTag(item._value || item.query || state.query, item._fieldType);
          window.pendingGuideLinkField = null;
          if (state.setQuery) state.setQuery('');
          return;
        }
        
        const fieldType = item._fieldType;
        const value = item._value;
        
        if (value?.trim()) {
          window.addTag(String(value).trim(), fieldType);
        }
        window.pendingGuideLinkField = null;
        if (state.setQuery) state.setQuery('');
      },
      getItemInputValue: () => '',
      // HTML templates for the autocomplete suggestions list
      templates: {
        item({ item, html, state }) {
          const fieldType = item._fieldType || 'undefined';
          const value = item._value;
          
          if (!value?.trim()) {
            return html`<div style="display: none;"></div>`;
          }
          
          const fieldLabel = fieldType === 'undefined' ? 'all fields' : window.fieldLabels[fieldType];
          
          if (item.isGuideLinkTag) {
            return html`<div class="suggestion-item">
              <span class="suggestion-value">${value} - <span class="click-to-add-text">${item.clickToAddText}</span></span>
              <span class="field-badge field-${fieldType}">${fieldLabel}</span>
            </div>`;
          }
          
          return html`<div class="suggestion-item">
            <span class="suggestion-value">${value}</span>
            <span class="field-badge field-${fieldType}">${fieldLabel}</span>
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

