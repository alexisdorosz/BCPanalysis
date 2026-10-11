import React from 'react';
import type { Rule, RuleTextNode } from '../src/study-types.js';

export function SourceLink({ url, anchor }: { url: string; anchor?: string }) {
  return (
    <a
      className="source-link"
      href={url + (anchor ? '#' + anchor : '')}
      target="_blank"
      rel="noreferrer noopener"
    >
      Wahapedia ↗
    </a>
  );
}
const allowedTags = new Set([
  'span',
  'strong',
  'em',
  'br',
  'p',
  'div',
  'ul',
  'ol',
  'li',
  'table',
  'tbody',
  'thead',
  'tr',
  'td',
  'th',
  'sup',
  'sub',
  'a',
  'h4',
]);
function RichText({ nodes }: { nodes: RuleTextNode[] }) {
  return nodes.map((node, index) => {
    if (node.type === 'text') return <React.Fragment key={index}>{node.text}</React.Fragment>;
    const Tag = (allowedTags.has(node.tag) ? node.tag : 'span') as React.ElementType;
    let href: string | undefined;
    if (node.tag === 'a' && node.href) {
      try {
        const url = new URL(node.href);
        if (
          url.protocol === 'https:' &&
          url.hostname === 'wahapedia.ru' &&
          url.pathname.startsWith('/aos4/') &&
          !url.username &&
          !url.password &&
          !url.port
        )
          href = url.href;
      } catch {
        /* Render invalid links as ordinary text. */
      }
    }
    return (
      <Tag
        key={index}
        className={node.keyword ? 'ability-keyword' : node.spacer ? 'ability-spacer' : undefined}
        href={href}
        target={href ? '_blank' : undefined}
        rel={href ? 'noreferrer noopener' : undefined}
        colSpan={node.colSpan}
        rowSpan={node.rowSpan}
      >
        {node.tag === 'br' ? undefined : <RichText nodes={node.children} />}
      </Tag>
    );
  });
}
const palette = new Set([
  '000000',
  '76602b',
  '606362',
  '5e4a79',
  '802022',
  '28435c',
  '3d5b26',
  'a34d14',
]);
function legacyColor(timing?: string): string {
  if (/hero phase/i.test(timing ?? '')) return '76602b';
  if (/movement phase/i.test(timing ?? '')) return '5e4a79';
  if (/shooting phase/i.test(timing ?? '')) return '28435c';
  if (/charge phase/i.test(timing ?? '')) return 'a34d14';
  if (/combat phase/i.test(timing ?? '')) return '802022';
  if (/end of (?:any|your|the|enemy) turn/i.test(timing ?? '')) return '3d5b26';
  return /passive/i.test(timing ?? '') ? '606362' : '000000';
}
function LegacyBody({ text }: { text: string }) {
  return (
    <div className="ability-plain-text">
      {text.split(/\n/).map((line, index) => {
        const label = /^(Declare|Effect|Reaction|Passive|Keywords):/.exec(line);
        return (
          <React.Fragment key={index}>
            {index > 0 && <br />}
            {label ? (
              <>
                <strong>{label[0]}</strong>
                {line.slice(label[0].length)}
              </>
            ) : (
              line
            )}
          </React.Fragment>
        );
      })}
    </div>
  );
}
export function Ability({ rule }: { rule: Rule }) {
  const sourceColor = rule.presentation?.color?.slice(1),
    color = sourceColor && palette.has(sourceColor) ? sourceColor : legacyColor(rule.timing);
  const badge = rule.presentation?.badge;
  const badgeLabel = badge
    ? { spell: 'Casting value', prayer: 'Chanting value', command: 'Command points' }[badge.kind] +
      ' ' +
      badge.value
    : undefined;
  const icon = rule.presentation?.icon;
  return (
    <article
      className={`ability ability-color-${color}${rule.presentation?.reaction ? ' ability-reaction' : ''}`}
      aria-label={rule.name}
    >
      <div className={`ability-header${badge ? ' has-badge' : ''}`}>
        <span className="ability-header-text">
          {icon && <img className="ability-icon" src={`/wahapedia/ab${icon}.png`} alt="" />}
          {rule.timing || rule.category}
        </span>
        {badge && (
          <span
            className={`ability-badge ability-badge-${badge.kind}`}
            aria-label={badgeLabel}
            title={badgeLabel}
          >
            <span>{badge.value}</span>
          </span>
        )}
      </div>
      <div className="ability-body">
        {rule.presentation ? (
          <RichText nodes={rule.presentation.body} />
        ) : (
          <>
            <h4>{rule.name}</h4>
            <br />
            <br />
            <LegacyBody text={rule.text} />
          </>
        )}
      </div>
      {!!rule.keywords.length && (
        <div className="ability-keywords">
          <span className="ability-keywords-label">
            <span className="ability-keyword">KEYWORDS</span>
          </span>
          <span className="ability-keywords-values">
            {rule.keywords.map((keyword, index) => (
              <React.Fragment key={index}>
                {index > 0 && ', '}
                <span className="ability-keyword">{keyword}</span>
              </React.Fragment>
            ))}
          </span>
        </div>
      )}
      <div className="ability-source">
        <SourceLink url={rule.source.url} anchor={rule.anchor} />
      </div>
    </article>
  );
}
export function Rules({
  rules,
  sectionTitle,
  selection,
}: {
  rules: Rule[];
  sectionTitle?: string;
  selection?: string;
}) {
  const prose = rules.filter((rule) => !rule.presentation && !rule.timing),
    abilities = rules.filter((rule) => rule.presentation || rule.timing);
  return (
    <>
      {prose.map((rule) => {
        const title = rule.name.replace(/ — context & restrictions$/, '');
        return (
          <div className="rule-prose" key={rule.id}>
            {title !== sectionTitle && title !== selection && <h4>{title}</h4>}
            <div className={rule.richText ? 'rule-prose-rich' : undefined}>
              {rule.richText ? <RichText nodes={rule.richText} /> : rule.text}
            </div>
            <SourceLink url={rule.source.url} anchor={rule.anchor} />
          </div>
        );
      })}
      {!!abilities.length && (
        <div className="ability-list">
          {abilities.map((rule) => (
            <Ability key={rule.id} rule={rule} />
          ))}
        </div>
      )}
    </>
  );
}
