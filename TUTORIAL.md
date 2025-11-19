# Boolean Tag Search

A common use case for search engines is to filter datasets based on simple boolean logic. Typesense supports queries like this by allowing for boolean expressions in the `filter_by` property. However, since the `filter_by` property only supports exact matches, this can mean trading off some of the flexibility of full-text search. One natural way around this problem is to implement an experience called a tag search. This cookbook will demonstrate the use case and process of building a tag-based search interface with Typesense.

## Overview

### Use Case

An example of how a tag-based search can mitigate the trade-offs between boolean logic and full-text search is shown below. In this cookbook, we'll consider a dataset of video games with genre and publisher fields. Let's say a user wanted to make a search request like:

> "Find all games published by either 'Nintendo' or 'Sony', that are either 'Adventure' or 'Casual' games."

We could represent this in a `filter_by` request like so:

```
filter_by: (publisher:Nintendo OR publisher:Sony) AND (genre:Adventure OR genre:Casual)
```

However, if the user accidentally typed "Adventur" instead of "Adventure", or if Nintendo is actually stored in the database as "Nintendo Co.", those fields in the boolean expression would not match the user's intent.

A tag-based search interface can be used to mitigate this problem. Instead of asking for the whole query at once, the user is asked to add tags to a tag cloud first. The user has to search for tags using an autocompleting drop-down menu. This menu matches their user input to the closest tags in the database, using the fuzzy-matching features of `query_by` requests. After adding all the tags they want to use, we can generate the search request by constructing a `filter_by` with a template like this:

```
filter_by: (publisher:<1st publisher tag> OR publisher:<2nd publisher tag>... OR publisher:<nth publisher tag>) 
       AND (genre:<1st genre tag>         OR genre:<2nd genre tag>...         OR genre:<nth genre tag>)
```

So in our previous scenario the user could add these tags:

- Typed "Adventur" → "Adventure"
- Typed "Nintendo" → "Nintendo Co."
- Typed "Sony" → "Sony Computer Entertainment"
- Typed "Casul" → "Casual"

And then we would generate the search request as:

```
filter_by: (publisher:Nintendo Co. OR publisher:Sony Computer Entertainment) AND (genre:Adventure OR genre:Casual)
```

Which would match the user's intent, even though their search input did not perfectly match the data in the database.

### Data Flow

The data flow for a tag-based search interface is as follows:

1. The user types a query into the search box.
2. The query is sent to the Typesense server using `query_by` across all fields.
3. The results are sorted by which field they match, and what the value of that field is.
4. Tags are constructed from the sorted values and displayed to the user as a list.
5. The user selects multiple tags to form a tag cloud.
6. The tag cloud is used to generate a search request using a `filter_by` template.
7. The search request is sent to the Typesense server using `multiSearch`.
8. The results are displayed to the user.

### Live Demo

A live demo for this cookbook can be found [here](https://boolean-search-games.typesense.org/). The full demo features some additional functionality not covered here to reduce code complexity, like showing a list of demo commands and haveing an option to exclude a tag once it has been added.

## Setup

Before implementing any search logic we'll initialize the Typesense client and define the fields we want to search across, as well as some utility varables like fieldPriority and an array for the tags.

```javascript
// Initialize Typesense client
const typesenseClient = new Typesense.Client({
  apiKey: 'your-api-key',
  nodes: [{ url: 'http://localhost:8108' }],
  connectionTimeoutSeconds: 2,
});

// Define searchable fields
const autocompleteFields = 'genres,supportedOperatingSystems,developer,publisher,title';
const searchFields = 'title,developer,publisher,genres,supportedOperatingSystems';
const fieldPriority = ['genres', 'supportedOperatingSystems', 'developer', 'publisher', 'title'];

// Field labels for display
const fieldLabels = {
  title: 'title',
  developer: 'developer',
  publisher: 'publisher',
  genres: 'genre',
  supportedOperatingSystems: 'OS',
};

// Store tags
let tags = [];
let tagIdCounter = 0;
```

## 1. Retrieve and Sort Autocompleted Tag Suggestions

We will start by creating a search box that users can type into to find Tags to filter by. To find potential Tags we will use a normal query_by request to our games table, and will then sort through the results to construct a list of possible tags relating to different fields.

### Search Box Setup

For the search box we will use Algolia's Autocomplete.js component. The `searchAutocomplete` function is triggered automatically as users type through the autocomplete's `getSources` callback:

```javascript
import { autocomplete } from '@algolia/autocomplete-js';

autocomplete({
  container: '#autocomplete',
  async getSources({ query }) {
    if (!query?.trim()) return [];
  
    const results = await searchAutocomplete(query);
    // Process and return suggestions...
  },
});
```

### Retrieve Suggestions

Now we'll create a function that queries Typesense when the user types. We'll use highlights to identify which fields matched the query, which will help us organize the suggestions by field type.

**Reference:** [typesense-queries.js:31-53](https://github.com/typesense/showcase-tag-search/blob/main/typesense-queries.js#L31-L53)

```javascript
async function searchAutocomplete(query) {
  if (!query?.trim()) return null;
  
  try {
    const results = await typesenseClient.collections('gog_games').documents().search({
      q: query, 
      query_by: autocompleteFields,
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
}
```

### Process and Sort Results

Next, we'll process the search results to extract matching values from different fields. We'll iterate through each hit and collect matches from array fields (like genres) and string fields (like title, developer, publisher). We use a 'seen' set to track tag values we have already added. This means if a query matches two documents on the same field, with the same value (eg: two games both made by the same publisher), then we will only add that tag once.

**Reference:** [ui-handlers.js:270-280](https://github.com/typesense/showcase-tag-search/blob/main/ui-handlers.js#L270-L280)

```javascript
autocomplete({
  container: '#autocomplete',
  async getSources({ query }) {
    if (!query?.trim()) return [];
  
    const results = await searchAutocomplete(query);
    if (!results) return [];
  
    return [{
      sourceId: 'predictions',
      getItems() {
        const seen = new Set();
        const items = [];
        const queryLower = query.toLowerCase();
  
        results.hits.forEach(hit => {
          collectArrayMatches(hit, query, 'genres', seen, items);
          collectArrayMatches(hit, query, 'supportedOperatingSystems', seen, items);
          collectFieldMatches(hit, query, seen, items);
        });

        // Add option to search in all fields if no exact match found
        if (query?.trim() && !tags.some(t => t.value.toLowerCase() === queryLower && t.fieldType === 'undefined')) {
          items.push({ _fieldType: 'undefined', _value: query, query });
        }
  
      return items;
    },
    ... // Later functions for getSelected, etc 
    }];
  },
});
```

### Helper Functions

We'll implement the helper functions from the code above to extract values from search results. These functions will handle both array fields (genres, supportedOperatingSystems) and string fields (title, developer, publisher).

**Reference:** [typesense-queries.js:110-155](https://github.com/typesense/showcase-tag-search/blob/main/typesense-queries.js#L110-L155)

```javascript
// Process array fields (e.g., genres, supportedOperatingSystems)
function collectArrayMatches(hit, query, fieldType, seen, items) {
  const { document: doc } = hit;
  const arr = doc[fieldType];
  if (!Array.isArray(arr)) return;
  
  const queryLower = query.toLowerCase();
  const match = arr.find(item => item && item.toLowerCase().includes(queryLower));
  if (match) {
    addAutocompleteItem(seen, items, hit, fieldType, match);
  }
}

// Process string fields
function collectFieldMatches(hit, query, seen, items) {
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
        addAutocompleteItem(seen, items, hit, fieldType, displayValue);
      }
    }
  });
}

// Prevent duplicates
function addAutocompleteItem(seen, items, hit, fieldType, value) {
  const key = `${fieldType}:${String(value).trim().toLowerCase()}`;
  if (seen.has(key)) return;
  
  seen.add(key);
  items.push({ ...hit, _fieldType: fieldType, _value: value });
}

// Extract field value from document/highlights
function getFieldValue(doc, highlights, field) {
  const highlight = highlights?.find(h => h.field === field);
  return highlight?.value?.replace(/<[^>]*>/g, '') || doc[field] || '';
}
```

**Reference:** [typesense-queries.js:56-59](https://github.com/typesense/showcase-tag-search/blob/main/typesense-queries.js#L56-L59)

### Display Suggestions in Autocomplete

Now we'll wire up the autocomplete component to display our processed results. We use a `templates.item` function to render each suggestion. The template displays the matching value and a field badge showing which field the tag belongs to (genre, title, developer, etc.). This helps users understand what type of tag they're selecting.

**Reference:** [ui-handlers.js:270-325](https://github.com/typesense/showcase-tag-search/blob/main/ui-handlers.js#L270-L325)

```javascript
autocomplete({
  container: '#autocomplete',
  async getSources({ query }) {
    if (!query?.trim()) return [];
  
    const results = await searchAutocomplete(query);
    if (!results) return [];
  
    return [{
      sourceId: 'predictions',
      getItems() {...}, // As implemented above
      templates: {
        item({ item, html, state }) {
          const fieldType = item._fieldType || 'undefined';
          const value = item._value;
  
          if (!value?.trim()) {
            return html`<div style="display: none;"></div>`;
          }
  
          const fieldLabel = fieldType === 'undefined' ? 'all fields' : fieldLabels[fieldType];
  
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

```

## 2. Add Selection to Tag Cloud

Now we'll implement the tag cloud functionality. When a user selects a suggestion from the autocomplete, we'll store it as a tag and display it in a tag cloud UI.

### On Selection

We'll create a function that adds the selected item to our tags array and triggers a re-render of the tag cloud display, and call it from the onSelect function of autocomplete.

**Reference:** [ui-handlers.js:42-51](https://github.com/typesense/showcase-tag-search/blob/main/ui-handlers.js#L42-L51)

```javascript
function addTag(value, fieldType) {
  const trimmed = value?.trim();
  // Prevent duplicate tags
  if (!trimmed || tags.some(t => t.value === trimmed && t.fieldType === fieldType)) return;
  
  tags.push({ 
    id: `tag-${tagIdCounter++}`, 
    value: trimmed, 
    fieldType,
    excludeChecked: false
  });
  
  renderTags();
}

autocomplete({
  container: '#autocomplete',
  async getSources({ query }) {
    if (!query?.trim()) return [];
  
    const results = await searchAutocomplete(query);
    if (!results) return [];
  
    return [{
      sourceId: 'predictions',
      getItems() {...}, //As above
      templates:{...}, // As above 
      onSelect({ item, state }) {
        const fieldType = item._fieldType;
        const value = item._value;
  
        if (value?.trim()) {
          addTag(String(value).trim(), fieldType);
        }
      },
    }];
  },
});
```

### Render Tags Helper

We'll use this function in the above code to render the tags in the UI, grouping them by field type so users can see which tags apply to which fields.

**Reference:** [ui-handlers.js:56-99](https://github.com/typesense/showcase-tag-search/blob/main/ui-handlers.js#L56-L99)

```javascript
function renderTags() {
  const container = document.getElementById('tags-container');
  if (!container) return;
  
  // Group tags by field type
  const tagsByType = {};
  tags.forEach(tag => {
    const key = tag.fieldType ?? 'undefined';
    if (!tagsByType[key]) {
      tagsByType[key] = [];
    }
    tagsByType[key].push(tag);
  });
  
  // Render HTML
  container.innerHTML = Object.entries(tagsByType).map(([fieldType, typeTags]) => {
    const typeLabel = fieldType === 'undefined' ? 'all fields' : fieldLabels[fieldType];
    const tagValues = typeTags.map(tag => `
      <span class="tag-value-item">
        <span class="tag-value">${tag.value}</span>
      </span>
    `).join('');
  
    return `
      <span class="tag">
        <span class="tag-type">${typeLabel}</span>
        ${tagValues}
      </span>
    `;
  }).join('');
}
```

## 3. Generate Filtered Query from Tag Cloud

Now we'll convert the selected tags into Typesense queries. Tags with a `fieldType == 'undefined'` will become full-text search queries across all fields, while other tags will become filter clauses.

### Build Filter Queries

We'll create a function that converts tags with field types into Typesense filter syntax. For array fields like genres, we'll use the `:` operator, and for string fields like title, we'll use `:=` for exact matching.

This is the part of the code where we construct our boolean search expression. In our case we are OR-ing all values of the same field type into a shared clause, and AND-ing all of those clauses together. But this logic could be any valid boolean equation, as defined by the filter_by docs [here](https://typesense.org/docs/29.0/api/search.html#filter-parameters)

**Reference:** [typesense-queries.js:163-189](https://github.com/typesense/showcase-tag-search/blob/main/typesense-queries.js#L163-L189)

```javascript
function buildDefinedFilters(tags) {
  const allFieldTypes = Object.keys(tags);
  if (allFieldTypes.length === 0) return undefined;
  
  const fieldFilters = allFieldTypes.map(fieldType => {
    const values = tags[fieldType] || [];
  
    const filters = values.map(value => {
      const escapedValue = escapeFilterValue(value);
      if (fieldType === 'genres' || fieldType === 'supportedOperatingSystems') {
        return `${fieldType}:${escapedValue}`;
      } else {
        return `${fieldType}:=${escapedValue}`;
      }
    });
  
    if (filters.length === 0) return null;
  
    // Join multiple values with OR
    return filters.length === 1 ? filters[0] : `(${filters.join(' || ')})`;
  }).filter(f => f !== null);
  
  // Join different field types with AND
  return fieldFilters.join(' && ');
}

function escapeFilterValue(value) {
  return value.replace(/"/g, '\\"');
}
```

### Generate Search Queries

Next we'll combine the defined filters and undefined queries into complete Typesense search query objects. We'll handle two cases: no undefined tags (only filters), or multiple undefined tags (multiple queries that we'll union together).

**Reference:** [typesense-queries.js:238-316](https://github.com/typesense/showcase-tag-search/blob/main/typesense-queries.js#L238-L316)

```javascript
function generateSearchQueries(tags) {
  if (!tags.length) {
    return [{ collection: 'gog_games', q: '*', query_by: searchFields }];
  }
  
  const definedTags = tags.filter(t => t.fieldType !== 'undefined');
  const undefinedTags = tags.filter(t => t.fieldType === 'undefined');
  
  // Group defined tags by field
  const definedByField = {};
  definedTags.forEach(tag => {
    if (!tag.value?.trim()) return;
    const fieldType = tag.fieldType;
    if (!definedByField[fieldType]) {
      definedByField[fieldType] = [];
    }
    definedByField[fieldType].push(tag.value.trim());
  });
  
  const undefinedQueryValues = undefinedTags
    .filter(tag => tag.value?.trim())
    .map(tag => tag.value.trim());
  
  const definedFilterBy = buildDefinedFilters(definedByField);
  
  // Build query based on whether we have undefined tags
  if (undefinedQueryValues.length === 0) {
    // Only filters, no text search
    const allFilterParts = [];
    if (definedFilterBy) {
      allFilterParts.push(`(${definedFilterBy})`);
    }
    const filterBy = allFilterParts.length > 0 ? allFilterParts.join(' && ') : undefined;

    const queryString = '*';
    return [buildQueryObject(queryString, filterBy, false)];
  } else {
    // Could have multiple undefined tags - create separate queries for each
    return undefinedQueryValues.map(undefinedValue => {
      const allFilterParts = [];
      if (definedFilterBy) {
        allFilterParts.push(`(${definedFilterBy})`);
      }
      const filterBy = allFilterParts.length > 0 ? allFilterParts.join(' && ') : undefined;  

      const queryString = undefinedValue;
      return buildQueryObject(queryString, filterBy, true);
    });
  }
}

function buildQueryObject(queryString, filterBy, hasUndefinedQuery) {
  const queryObj = {
    collection: 'gog_games',
    q: queryString,
    query_by: hasUndefinedQuery ? searchFields : undefined, // searchFields defined in Setup section
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
```

### Execute Queries

Finally, we'll execute the generated queries using Typesense's multiSearch API. This allows us to handle multiple queries and union the results together, which allows us to get OR logic when we have multiple "all fields" tags.

**Reference:** [ui-handlers.js:218-225](https://github.com/typesense/showcase-tag-search/blob/main/ui-handlers.js#L218-L225)

```javascript
async function loadResults(page = 1) {
  if (!tags.length) return clearResults();
  
  const queries = generateSearchQueries(tags);
  
  try {
    // Use multiSearch for multiple queries, or single search for one query
    const result = await typesenseClient.multiSearch.perform({
      union: true,
      remove_duplicates: true,
      searches: queries,
    }, {
      page,
      per_page: 10,
    });
  
    const hits = result.hits || [];
    // Display results...
  } catch (error) {
    console.error('Error loading results:', error);
  }
}
```

We'll add this to addTag(), beneath our call to render the tag cloud:

```javascript
window.addTag = function(value, fieldType) {
  ... // Pushing new tag code, defined above
  window.renderTags();
  window.loadResults();
};
```

## Summary

In this tutorial, we've built a tag-based search interface with the following flow:

1. **Autocomplete**: We query Typesense as users type and extract matching values from highlights to show suggestions
2. **Tag Storage**: We store selected tags with their field types in an array
3. **Query Building**: We convert tags into Typesense filters (for defined fields) and search queries (for undefined/all fields)
4. **Execution**: We run the queries using multiSearch and display the results

The key concept is that tags with a `fieldType` become `filter_by` clauses, while tags without a `fieldType` become full-text search queries across all fields.
