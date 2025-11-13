const { autocomplete } = window['@algolia/autocomplete-js'];

const typesenseClient = new Typesense.Client({
  apiKey: window.TYPESENSE_SEARCH_ONLY_API_KEY || 'xyz',
  nodes: [{ url: window.TYPESENSE_URL || 'http://localhost:8108' }],
  connectionTimeoutSeconds: 2,
});

let tags = [];
let tagIdCounter = 0;
let currentPage = 1;
const resultsPerPage = 10;
let totalResults = 0;
let genresUseAnd = false;
let supportedOperatingSystemsUseAnd = false;
let pendingGuideLinkField = null;

const fieldLabels = {
  title: 'title',
  developer: 'developer',
  publisher: 'publisher',
  genres: 'genre',
  supportedOperatingSystems: 'OS',
};

const autocompleteFields = 'genres,supportedOperatingSystems,developer,publisher,title';
const searchFieldWeights = '5,4,3,2,1';
const searchFields = 'title,developer,publisher,genres,supportedOperatingSystems';
const fieldPriority = ['genres', 'supportedOperatingSystems', 'developer', 'publisher', 'title'];

//--------------------- Initialization ---------------------

function setupEnterKeyHandler() {
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
            addTag(query, undefined);
            autocompleteInput.value = '';
            if (panel) {
              panel.style.display = 'none';
            }
          }
        }
      });
    }
  }, 100);
}

function init() {
  const autocompleteContainer = document.getElementById('autocomplete');
  if (autocompleteContainer && !document.getElementById('tags-container')) {
    const guidingText = document.createElement('div');
    guidingText.id = 'guiding-text';
    guidingText.className = 'guiding-text';
    autocompleteContainer.parentNode.insertBefore(guidingText, autocompleteContainer.nextSibling);
    
    updateGuidingText();
    
    const tagsContainer = document.createElement('div');
    tagsContainer.id = 'tags-container';
    tagsContainer.className = 'tags-container';
    autocompleteContainer.parentNode.insertBefore(tagsContainer, guidingText.nextSibling);
  }
  
  const main = document.querySelector('main');
  if (main && !document.getElementById('results-container')) {
    const resultsContainer = document.createElement('div');
    resultsContainer.id = 'results-container';
    resultsContainer.className = 'results-container';
    resultsContainer.innerHTML = '<div id="results-list"></div><div id="results-pagination"></div>';
    main.appendChild(resultsContainer);
  }
  
  renderTags();
  setupEnterKeyHandler();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}

//--------------------- Autoocomplete Query Building ---------------------

// Generates the autocomplete suggestions list from the content of the search bar.
autocomplete({
  container: '#autocomplete',
  placeholder: 'Start typing to find tags for title, genre, developer ...',
  detachedMediaQuery: 'none',
  openOnFocus: false,
  async getSources({ query }) {
    if (!query?.trim()) {
      pendingGuideLinkField = null; // Used by the guide links (Try: Electronic Arts, etc)
      return [];
    }
    
    const results = await debouncedSearch(query);
    
    if (!results) return [];
    
    return [{
      sourceId: 'predictions',
      getItems() {
        const seen = new Set();
        const byCategory = {};
        const queryLower = query.toLowerCase();
        
        results.hits.forEach(hit => {
          // Helper functions defined below.
          collectArrayMatches(hit, query, 'genres', byCategory, seen, 3);
          collectArrayMatches(hit, query, 'supportedOperatingSystems', byCategory, seen, 3);
          collectFieldMatches(hit, query, byCategory, seen);
        });
        
        const items = fieldPriority
          .filter(fieldType => byCategory[fieldType])
          .flatMap(fieldType => byCategory[fieldType]);
        
        // Adding guide link text when the user clicks on "Try: ..." suggestion tags
        if (pendingGuideLinkField !== null) {
          const fieldType = pendingGuideLinkField;
          const fieldLabel = fieldType === undefined ? 'all fields' : fieldLabels[fieldType];
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
            
            const itemFieldType = item._fieldType || determineFieldType(item, query);
            if (itemFieldType === fieldType) {
              let itemValue = item._value;
              if (!itemValue) {
                if (itemFieldType === 'genres' || itemFieldType === 'supportedOperatingSystems') {
                  itemValue = getArrayValue(item.document, item.highlights, itemFieldType, query);
                } else {
                  itemValue = getFieldValue(item.document, item.highlights, itemFieldType);
                }
              }
              if (itemValue && String(itemValue).toLowerCase().trim() === queryLower) {
                itemsToRemove.push(index);
              }
            }
          });
          
          itemsToRemove.reverse().forEach(index => items.splice(index, 1));
        } else if (query?.trim() && !tags.some(t => t.value.toLowerCase() === queryLower)) {
          items.push({ isUndefinedTag: true, query });
        }
        
        return items;
      },
      onSelect({ item, state }) {
        if (item.isGuideLinkTag) {
          addTag(item.query || state.query, item.fieldType);
          pendingGuideLinkField = null;
          state.setQuery('');
          return;
        }
        
        if (item.isUndefinedTag) {
          addTag(item.query || state.query, undefined);
          pendingGuideLinkField = null;
          state.setQuery('');
          return;
        }
        
        // For regular autocomplete items: determines field type, extracts value from document/highlights 
        // (using getArrayValue for array fields, getFieldValue for strings), then adds the tag and clears the input
        const fieldType = item._fieldType || determineFieldType(item, state.query);
        let value = item._value;
        if (!value) {
          if (fieldType === 'genres' || fieldType === 'supportedOperatingSystems') {
            value = getArrayValue(item.document, item.highlights, fieldType, state.query);
          } else {
            value = getFieldValue(item.document, item.highlights, fieldType);
          }
        }
        
        if (value?.trim()) {
          addTag(String(value).trim(), fieldType);
        }
        pendingGuideLinkField = null;
        state.setQuery('');
      },
      getItemInputValue: () => '',
      // HTML templates for the autocomplete suggestions list
      templates: {
        item({ item, html, state }) {
          if (item.isGuideLinkTag) {
            const fieldType = item.fieldType;
            const fieldLabel = fieldType === undefined ? 'all fields' : fieldLabels[fieldType];
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
          
          const fieldType = item._fieldType || determineFieldType(item, state.query);
          const value = getDisplayValue(item, state);
          
          if (!value?.trim()) {
            return html`<div style="display: none;"></div>`;
          }
          
          return html`<div class="suggestion-item">
            <span class="suggestion-value" dangerouslySetInnerHTML=${{ __html: value }}></span>
            <span class="field-badge field-${fieldType}">${fieldLabels[fieldType]}</span>
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

function getFieldValue(doc, highlights, field) {
  const highlight = highlights?.find(h => h.field === field);
  return highlight?.value?.replace(/<[^>]*>/g, '') || doc[field] || '';
}

// Extracts the display value for an autocomplete item
function getDisplayValue(item, state) {
  return item._value;
}

// Helpers in autocomplete getItems() to build the suggestions list from search results: 
// collectArrayMatches finds matching values in array fields (genres, OS),
// collectFieldMatches checks string fields (developer, publisher, title) independently. 
// addAutocompleteItem prevents duplicates and limits items per field type,

function collectArrayMatches(hit, query, fieldType, byCategory, seen, maxItems) {
  const { document: doc } = hit;
  const arr = doc[fieldType];
  if (!Array.isArray(arr)) return;
  
  const queryLower = query.toLowerCase();
  const match = arr.find(item => item && item.toLowerCase().includes(queryLower));
  if (match) {
    addAutocompleteItem(byCategory, seen, hit, fieldType, match, maxItems);
  }
}

// Typesense uses Highlights to mark matching query terms with <b> tags. 
// Each highlight object contains { field: 'fieldName', value: 'text with <b>matched</b> terms' }

function collectFieldMatches(hit, query, byCategory, seen) {
  const { highlights, document: doc } = hit;
  const queryLower = query.toLowerCase();
  
  const fieldsToCheck = ['developer', 'publisher', 'title'];
  
  fieldsToCheck.forEach(fieldType => {
    const value = doc[fieldType];
    if (!value || typeof value !== 'string') return;
    
    if (value.toLowerCase().includes(queryLower)) {
      const highlight = highlights?.find(h => h.field === fieldType);
      const displayValue = highlight ? getFieldValue(doc, highlights, fieldType) : value;
      
      if (displayValue?.trim()) {
        addAutocompleteItem(byCategory, seen, hit, fieldType, displayValue, 3);
      }
    }
  });
}

function addAutocompleteItem(byCategory, seen, hit, fieldType, value, maxItems = 3) {
  const key = `${fieldType}:${String(value).trim().toLowerCase()}`;
  if (seen.has(key)) return;
  
  seen.add(key);
  if (!byCategory[fieldType]) byCategory[fieldType] = [];
  if (byCategory[fieldType].length < maxItems) {
    byCategory[fieldType].push({ ...hit, _fieldType: fieldType, _value: value });
  }
}

// Functions used to check which field the item selected matches in the current query, during onSelect():
// It falls back to checking fieldPriority order for case-insensitive substring matches if no highlights are found.
// collectFieldMatches is used to actually build the suggestions list from search results
function determineFieldType(item, query) {
  const { highlights, document: doc } = item;
  
  if (highlights?.length) {
    const matched = highlights.find(h => h.value?.includes('<b>'));
    if (matched) return matched.field;
    return highlights[0].field;
  }
  
  const queryLower = query.toLowerCase();
  for (const field of fieldPriority) {
    const value = doc[field];
    if (!value) continue;
    
    if (Array.isArray(value)) {
      if (value.some(v => v?.toLowerCase().includes(queryLower))) return field;
    } else if (value.toLowerCase().includes(queryLower)) {
      return field;
    }
  }
  
  return 'title';
}

// This determines field type for array fields like Genres or Supported Operating Systems
function getArrayValue(doc, highlights, field, query) {
  const arr = doc[field] || [];
  if (!arr.length) return '';
  
  const highlight = highlights?.find(h => h.field === field);
  const queryLower = query.toLowerCase();
  
  if (highlight) {
    const text = highlight.value?.replace(/<[^>]*>/g, '');
    return arr.find(v => text?.includes(v)) || 
           arr.find(v => v.toLowerCase().includes(queryLower)) || 
           arr[0];
  }
  
  return arr.find(v => v.toLowerCase().includes(queryLower)) || arr[0];
}

// Debounces the search query to prevent excessive requests to the server
function debouncePromise(fn, wait) {
  let timeout;
  let pendingResolve = null;
  let lastArgs = null;
  
  return function(...args) {
    lastArgs = args;
    
    return new Promise((resolve) => {
      if (pendingResolve) {
        pendingResolve(null);
      }
      pendingResolve = resolve;
      
      clearTimeout(timeout);
      timeout = setTimeout(async () => {
        const result = await fn(...args);
        if (pendingResolve === resolve) {
          resolve(result);
          pendingResolve = null;
        }
      }, wait);
    });
  };
}

const debouncedSearch = debouncePromise(async (query) => {
  if (!query?.trim()) return null;
  
  try {
    const results = await typesenseClient.collections('gog_games').documents().search({
      q: query, 
      query_by: autocompleteFields,
      query_by_weights: searchFieldWeights,
      highlight_full_fields: autocompleteFields,
      highlight_start_tag: '<b>',
      highlight_end_tag: '</b>',
      per_page: 20,
      prefix: true,
      infix: 'always',
      prioritize_exact_match: true,
      prioritize_token_position: true,
    });
    return results;
  } catch (error) {
    console.error('Search error:', error);
    return null;
  }
}, 300);

//--------------------- Final Query Building ---------------------

// Generates the search queries for the typesense search that serves results, based on the tags selected by the user
// Helper function defined below.
function generateSearchQueries(tags) {
  if (!tags.length) {
    return [{ collection: 'gog_games', q: '*', query_by: searchFields }];
  }
  
  const excludeTags = tags.filter(t => t.excludeChecked);
  const queryTags = tags.filter(t => !t.excludeChecked);
  
  const definedTags = queryTags.filter(t => t.fieldType);
  const undefinedTags = queryTags.filter(t => !t.fieldType);
  const definedExcludeTags = excludeTags.filter(t => t.fieldType);
  const undefinedExcludeTags = excludeTags.filter(t => !t.fieldType);
  
  // Group defined-type tags into an object for constructing filters
  const definedByField = {};
  definedTags.forEach(tag => {
    if (!tag.value?.trim()) return;
    const fieldType = tag.fieldType;
    if (!definedByField[fieldType]) {
      definedByField[fieldType] = [];
    }
    definedByField[fieldType].push(tag.value.trim());
  });
  
  const undefinedQueryValues = [];
  undefinedTags.forEach(tag => {
    if (tag.value?.trim()) {
      undefinedQueryValues.push(tag.value.trim());
    }
  });
  
  const definedFilterBy = buildDefinedFilters(definedByField);
  const exclusionFilterParts = buildExclusionFilters(definedExcludeTags);
  const undefinedExclusionTerms = buildUndefinedExclusions(undefinedExcludeTags);
  
  // Three cases: no undefined tags, one undefined tag, multiple undefined tags
  // Build the query string and filter by the defined tags and exclusion tags
  // If there is one undefined tag, add it as a query string against all fields 
  // If there are multiple undefined tags, create a list of queries for each undefined tag, that we will union together later
  if (undefinedQueryValues.length === 0) {
    const allFilterParts = [];
    if (definedFilterBy) {
      allFilterParts.push(`(${definedFilterBy})`);
    }
    allFilterParts.push(...exclusionFilterParts);
    const filterBy = allFilterParts.length > 0 ? allFilterParts.join(' && ') : undefined;
    
    const queryString = undefinedExclusionTerms ? `* ${undefinedExclusionTerms}` : '*';
    return [buildQueryObject(queryString, filterBy, !!undefinedExclusionTerms)];
  } else if (undefinedQueryValues.length === 1) {
    const allFilterParts = [];
    if (definedFilterBy) {
      allFilterParts.push(`(${definedFilterBy})`);
    }
    allFilterParts.push(...exclusionFilterParts);
    const filterBy = allFilterParts.length > 0 ? allFilterParts.join(' && ') : undefined;
    
    const queryString = undefinedExclusionTerms 
      ? `${undefinedQueryValues[0]} ${undefinedExclusionTerms}`
      : undefinedQueryValues[0];
    
    return [buildQueryObject(queryString, filterBy, true)];
  } else {
    return undefinedQueryValues.map(undefinedValue => {
      const allFilterParts = [];
      if (definedFilterBy) {
        allFilterParts.push(`(${definedFilterBy})`);
      }
      allFilterParts.push(...exclusionFilterParts);
      const filterBy = allFilterParts.length > 0 ? allFilterParts.join(' && ') : undefined;
      
      const queryString = undefinedExclusionTerms 
        ? `${undefinedValue} ${undefinedExclusionTerms}`
        : undefinedValue;
      
      return buildQueryObject(queryString, filterBy, true);
    });
  }
}

// Helper functions to build the filter by the defined, excluded and undefined tags 

function escapeFilterValue(value) {
  return value.replace(/"/g, '\\"');
}

function buildDefinedFilters(definedByField) {
  const allFieldTypes = Object.keys(definedByField);
  if (allFieldTypes.length === 0) return undefined;
  
  const fieldFilters = allFieldTypes.map(fieldType => {
    const values = definedByField[fieldType] || [];
    
    const filters = values.map(value => {
      const escapedValue = escapeFilterValue(value);
      if (fieldType === 'genres' || fieldType === 'supportedOperatingSystems') {
        return `${fieldType}:${escapedValue}`;
      } else {
        return `${fieldType}:=${escapedValue}`;
      }
    });
    
    if (filters.length === 0) return null;
    
    if ((fieldType === 'genres' && genresUseAnd) || (fieldType === 'supportedOperatingSystems' && supportedOperatingSystemsUseAnd)) {
      return filters.length === 1 ? filters[0] : `(${filters.join(' && ')})`;
    } else {
      return filters.length === 1 ? filters[0] : `(${filters.join(' || ')})`;
    }
  }).filter(f => f !== null);
  
  return fieldFilters.join(' && ');
}

function buildExclusionFilters(definedExcludeTags) {
  const exclusionFilterParts = [];
  
  definedExcludeTags.forEach(tag => {
    if (!tag.value?.trim()) return;
    const fieldType = tag.fieldType;
    const escapedValue = escapeFilterValue(tag.value.trim());
    if (fieldType === 'genres' || fieldType === 'supportedOperatingSystems') {
      exclusionFilterParts.push(`${fieldType}:!=${escapedValue}`);
    } else {
      exclusionFilterParts.push(`${fieldType}:!=${escapedValue}`);
    }
  });
  
  return exclusionFilterParts;
}

function buildUndefinedExclusions(undefinedExcludeTags) {
  return undefinedExcludeTags
    .filter(tag => tag.value?.trim())
    .map(tag => {
      const value = tag.value.trim();
      const tokens = value.split(/\s+/).filter(t => t.length > 0);
      return tokens.map(t => `-${t}`).join(' ');
    })
    .join(' ');
}

function buildQueryObject(queryString, filterBy, hasUndefinedQuery) {
  const queryObj = {
    collection: 'gog_games',
    q: queryString,
    query_by: hasUndefinedQuery ? searchFields : undefined,
    drop_tokens_threshold: 0,
    prioritize_exact_match: true,
    prioritize_token_position: true,
    prefix: true,
  };
  
  if (filterBy) {
    queryObj.filter_by = filterBy;
  }
  
  return queryObj;
}

//--------------------- Tag GUI Cloud ---------------------

//Add tag to our tags array, and render the tags UI
function addTag(value, fieldType) {
  const trimmed = value?.trim();
  if (!trimmed || tags.some(t => t.value === trimmed && t.fieldType === fieldType)) return;
  tags.push({ 
    id: `tag-${tagIdCounter++}`, 
    value: trimmed, 
    fieldType,
    excludeChecked: false
  });
  renderTags();
  updateGuidingText(); // Update the guiding text to show the user what to try next
  loadResults();
}

function renderTags() {
  const container = document.getElementById('tags-container');
  if (!container) return;
  
  const tagsByType = {};
  tags.forEach(tag => {
    const key = tag.fieldType ?? 'undefined';
    if (!tagsByType[key]) {
      tagsByType[key] = [];
    }
    tagsByType[key].push(tag);
  });
  
  //Template for the tags UI
  container.innerHTML = Object.entries(tagsByType).map(([fieldType, typeTags]) => {
    const typeLabel = fieldType === 'undefined' ? 'all fields' : fieldLabels[fieldType];
    const tagValues = typeTags.map(tag => `
      <span class="tag-value-item">
        <span class="tag-value">${tag.value}</span>
        <input type="checkbox" class="tag-checkbox tag-checkbox-exclude" data-id="${tag.id}" ${tag.excludeChecked ? 'checked' : ''} />
      </span>
    `).join('');
    
    const andOrSwitch = fieldType === 'genres' ? `
      <button class="tag-andor-switch" title="${genresUseAnd ? 'Switch to OR' : 'Switch to AND'}" data-field-type="${fieldType}">
        <span class="tag-andor-option ${!genresUseAnd ? 'active' : ''}">OR</span>
        <span class="tag-andor-option ${genresUseAnd ? 'active' : ''}">AND</span>
      </button>
    ` : fieldType === 'supportedOperatingSystems' ? `
      <button class="tag-andor-switch" title="${supportedOperatingSystemsUseAnd ? 'Switch to OR' : 'Switch to AND'}" data-field-type="${fieldType}">
        <span class="tag-andor-option ${!supportedOperatingSystemsUseAnd ? 'active' : ''}">OR</span>
        <span class="tag-andor-option ${supportedOperatingSystemsUseAnd ? 'active' : ''}">AND</span>
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
    checkbox.onchange = (e) => handleExcludeChange(checkbox.dataset.id, e.target.checked);
  });
  
  container.querySelectorAll('.tag-andor-switch').forEach(btn => {
    btn.onclick = () => handleAndOrToggle(btn.dataset.fieldType);
  });
  
  container.querySelectorAll('.tag-remove').forEach(btn => {
    btn.onclick = () => removeTagsByType(btn.dataset.fieldType);
  });
}

function handleAndOrToggle(fieldType) {
  if (fieldType === 'genres') {
    genresUseAnd = !genresUseAnd;
  } else if (fieldType === 'supportedOperatingSystems') {
    supportedOperatingSystemsUseAnd = !supportedOperatingSystemsUseAnd;
  }
  renderTags();
  loadResults();
}

// Handle the change of the exclude checkbox for a tag
function handleExcludeChange(tagId, checked) {
  const tag = tags.find(t => t.id === tagId);
  if (!tag) return;
  
  tag.excludeChecked = checked;
  
  renderTags();
  updateGuidingText();
  loadResults();
}

function removeTag(id) {
  tags = tags.filter(t => t.id !== id);
  renderTags();
  updateGuidingText();
  tags.length ? loadResults() : clearResults();
}

// Remove tags all tags of a set type, and update the guiding text
function removeTagsByType(fieldType) {
  tags = tags.filter(t => {
    if (fieldType === 'undefined') {
      return t.fieldType !== undefined && t.fieldType !== null;
    } else {
      return t.fieldType !== fieldType;
    }
  });
  renderTags();
  updateGuidingText();
  tags.length ? loadResults() : clearResults();
}

//--------------------- Demo Suggestions Flow ---------------------

function updateGuidingText() {
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
  
  const hasElectronicArts = tags.some(t => t.value === 'Electronic Arts' && t.fieldType === 'publisher');
  const hasRolePlaying = tags.some(t => t.value === 'Role-playing' && t.fieldType === 'genres');
  const hasTHQNordic = tags.some(t => t.value === 'THQ Nordic GmbH' && t.fieldType === 'publisher');
  const hasAction = tags.some(t => t.value === 'Action' && t.fieldType === 'genres');
  const hasDark = tags.some(t => t.value === 'Dark' && t.fieldType === undefined);
  const has2 = tags.some(t => t.value === '2' && t.fieldType === undefined);
  
  const allGuideTagsPresent = hasElectronicArts && hasRolePlaying && hasTHQNordic && hasAction && hasDark && has2;
  
  const hasOtherTags = tags.some(t => {
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
      pendingGuideLinkField = field;
      const autocompleteInput = autocompleteContainer?.querySelector('input[type="search"], input[type="text"]');
      if (autocompleteInput) {
        autocompleteInput.value = value;
        autocompleteInput.focus();
        autocompleteInput.dispatchEvent(new Event('input', { bubbles: true }));
      }
    };
  });
}

//--------------------- Results Display ---------------------

function formatGame(doc) {
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
}

function renderPagination(page, totalResults) {
  const totalPages = Math.ceil(totalResults / resultsPerPage);
  if (totalPages <= 1) {
    return `<div class="results-info">Found ${totalResults} result${totalResults !== 1 ? 's' : ''}</div>`;
  }
  
  const startIdx = (page - 1) * resultsPerPage;
  const endIdx = Math.min(startIdx + resultsPerPage, totalResults);
  
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
}

async function loadResults(page = 1) {
  if (!tags.length) return clearResults();
  
  currentPage = page;
  const queries = generateSearchQueries(tags);
  
  const list = document.getElementById('results-list');
  const pagination = document.getElementById('results-pagination');
  if (!list || !pagination) {
    setTimeout(() => loadResults(page), 100);
    return;
  }
  
  list.innerHTML = '<div class="loading">Loading...</div>';
  
  try {
    // Union the results for when multiple all-fields tags are present, and remove duplicates
    const result = await typesenseClient.multiSearch.perform({
      union: true,
      remove_duplicates: true,
      searches: queries,
    }, {
      page,
      per_page: resultsPerPage,
    });
    
    const hits = result.hits || [];
    totalResults = result.found || 0;
    
    if (hits.length) {
      list.innerHTML = hits.map(hit => formatGame(hit.document)).join('');
      pagination.innerHTML = renderPagination(page, totalResults);
    } else {
      list.innerHTML = '<div class="no-results">No results</div>';
      pagination.innerHTML = '';
    }
  } catch (error) {
    list.innerHTML = '<div class="error">Error loading results</div>';
    pagination.innerHTML = '';
  }
}

function clearResults() {
  const list = document.getElementById('results-list');
  const pagination = document.getElementById('results-pagination');
  if (list) list.innerHTML = '';
  if (pagination) pagination.innerHTML = '';
  currentPage = 1;
  totalResults = 0;
}

window.loadResults = loadResults;

