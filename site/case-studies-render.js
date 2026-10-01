// Markup for case studies — the ONE place the HTML is defined.
//
// Two consumers, same output:
//   • .github/scripts/prerender-case-studies.mjs runs this at build time and
//     writes the result into the static HTML, so crawlers, link previews and
//     ATS scrapers get the content without executing JavaScript.
//   • The pages call it in the browser only when the HTML wasn't pre-rendered
//     (local preview, or a deploy that skipped the build step).
// Data lives in case-studies.js; edit that, not the generated markup.
(function (root) {
  // Full writeup on /case-studies.
  function study(c) {
    const d = c.detail;
    const body = d ? `
        <dl>
          <dt>Context</dt><dd>${d.context}</dd>
          <dt>Problem</dt><dd>${c.problem}</dd>
          <dt>Diagnosis</dt><dd>${d.diagnosis}</dd>
          <dt>The fix</dt><dd>${d.fix}</dd>
          <dt>Impact</dt><dd>${d.impact}</dd>
          ${d.postscript ? `<dt>Postscript</dt><dd>${d.postscript}</dd>` : ''}
          ${d.lessons && d.lessons.length ? `<dt>Lessons</dt><dd><ul class="lessons">${d.lessons.map(l => `<li>${l}</li>`).join('')}</ul></dd>` : ''}
        </dl>` : `
        <dl>
          <dt>Problem</dt><dd>${c.problem}</dd>
          <dt>Approach</dt><dd>${c.approach}</dd>
        </dl>
        <p class="wip">full writeup in progress — the summary above is the shape of it</p>`;
    return `
      <article class="study" id="${c.slug}">
        <div class="tag">${c.tag}</div>
        <h2>${c.title}</h2>
        ${body}
        <div class="outcome">${c.outcome}</div>
        <div class="tech-tags">${(c.stack || []).map(s => `<span>${s}</span>`).join('')}</div>
      </article>`;
  }

  // Summary card on the homepage.
  function card(c) {
    return `
      <article class="case">
        <div class="tag">${c.tag}</div>
        <h3><a href="/case-studies#${c.slug}">${c.title}</a></h3>
        <dl>
          <dt>Problem</dt>
          <dd>${c.problem}</dd>
          <dt>Approach</dt>
          <dd>${c.approach}</dd>
        </dl>
        <div class="outcome">${c.outcome}</div>
        <a class="more" href="/case-studies#${c.slug}">${c.detail ? 'full writeup →' : 'writeup in progress →'}</a>
      </article>`;
  }

  root.CaseStudiesRender = {
    studies: list => list.map(study).join(''),
    cards: list => list.map(card).join(''),
  };
})(typeof window !== 'undefined' ? window : this);
