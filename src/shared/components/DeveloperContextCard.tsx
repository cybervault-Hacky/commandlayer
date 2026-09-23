import {
  GitHubSurface,
  GitHubVisibility,
  repositorySlug,
  type GitHubPageContext,
} from '@/github/types';
import { cn } from '@/shared/utilities/cn';
import { surfaceLabel } from './developerLabels';
import {
  IconBranch,
  IconCode,
  IconGlobe,
  IconInfo,
  IconIssue,
  IconLock,
  IconPullRequest,
  IconRepo,
  IconSpinner,
} from './icons';

export interface DeveloperContextCardProps {
  github: GitHubPageContext | null;
  loading?: boolean;
  className?: string;
}

/**
 * Phase 7 — Developer Mode: the repository context of the page you are on.
 *
 * Read-only and explicit about provenance: everything shown here was read
 * from the page GitHub already rendered. Nothing was downloaded, and the
 * "captured from" line states whether identity came from the URL, GitHub's
 * own metadata, or the rendered structure.
 */
export function DeveloperContextCard({
  github,
  loading = false,
  className,
}: DeveloperContextCardProps) {
  if (loading) {
    return (
      <div className={cn('cl-card flex items-center gap-2 p-3.5', className)}>
        <IconSpinner size={13} className="cl-spin text-text-muted" />
        <span className="text-[11.5px] text-text-muted">
          Reading repository context…
        </span>
      </div>
    );
  }

  if (github === null) return null;

  const slug = repositorySlug(github);
  const isRepo = github.surface === GitHubSurface.Repository;

  return (
    <section
      className={cn('cl-card cl-enter overflow-hidden', className)}
      aria-labelledby="developer-context-heading"
    >
      <div className="flex items-center justify-between gap-2 border-b border-border/70 px-3.5 py-2.5">
        <span className="flex min-w-0 items-center gap-1.5 text-[10px] font-medium uppercase tracking-[0.08em] text-text-muted">
          <IconRepo size={12} className="shrink-0 text-accent" />
          <span id="developer-context-heading">Developer context</span>
        </span>
        <span className="flex shrink-0 items-center gap-1.5">
          {github.visibility === GitHubVisibility.Private && (
            <span className="flex items-center gap-1 rounded-full border border-border px-1.5 py-0.5 text-[9.5px] text-text-muted">
              <IconLock size={9} />
              Private
            </span>
          )}
          <span className="rounded-full border border-border px-1.5 py-0.5 text-[9.5px] uppercase tracking-[0.04em] text-text-muted">
            {surfaceLabel(github.surface)}
          </span>
        </span>
      </div>

      <div className="px-3.5 py-3">
        <dl className="flex flex-col gap-2">
          {slug && (
            <Row icon={<IconRepo size={12} />} label="Repository" value={slug} mono />
          )}
          {github.branch && (
            <Row icon={<IconBranch size={12} />} label="Ref" value={github.branch} mono />
          )}
          {github.path && (
            <Row
              icon={<IconCode size={12} />}
              label={github.surface === GitHubSurface.Directory ? 'Directory' : 'File'}
              value={github.path}
              mono
            />
          )}
          {github.language && (
            <Row icon={<IconCode size={12} />} label="Language" value={github.language} />
          )}
          {github.pullRequestNumber !== null && (
            <Row
              icon={<IconPullRequest size={12} />}
              label="Pull request"
              value={`#${github.pullRequestNumber}`}
            />
          )}
          {github.issueNumber !== null && (
            <Row
              icon={<IconIssue size={12} />}
              label="Issue"
              value={`#${github.issueNumber}`}
            />
          )}
          {github.commitSha && (
            <Row
              icon={<IconBranch size={12} />}
              label="Commit"
              value={github.commitSha.slice(0, 10)}
              mono
            />
          )}
          {github.searchQuery && (
            <Row
              icon={<IconGlobe size={12} />}
              label="Search"
              value={`“${github.searchQuery}”`}
            />
          )}
        </dl>

        <div className="mt-2.5 flex flex-wrap gap-1.5 border-t border-border/70 pt-2.5">
          {github.files.length > 0 && (
            <Chip label={`${github.files.length} ${isRepo ? 'entries' : 'files listed'}`} />
          )}
          {github.changedFiles.length > 0 && (
            <Chip label={`${github.changedFiles.length} changed`} />
          )}
          {github.additions !== null && <Chip label={`+${github.additions}`} />}
          {github.deletions !== null && <Chip label={`−${github.deletions}`} />}
          {github.codeLines.length > 0 && (
            <Chip label={`${github.codeLines.length} code lines`} />
          )}
          {github.diffLines.length > 0 && (
            <Chip label={`${github.diffLines.length} diff lines`} />
          )}
          {github.readmeExcerpt && <Chip label="README" />}
        </div>

        <p className="mt-2.5 flex items-start gap-1.5 text-[10.5px] leading-4 text-text-muted">
          <IconInfo size={11} className="mt-0.5 shrink-0" />
          <span>
            Read from this page only — nothing was downloaded.
            {github.truncated ? ' Some sections were truncated by CommandLayer limits.' : ''}
            {!github.evidence.meta && github.evidence.url
              ? ' Identity came from the URL; the page did not corroborate it.'
              : ''}
          </span>
        </p>
      </div>
    </section>
  );
}

function Row({
  icon,
  label,
  value,
  mono = false,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="flex min-w-0 items-baseline gap-2">
      <dt className="flex shrink-0 items-center gap-1.5 text-[10.5px] uppercase tracking-[0.05em] text-text-muted">
        <span className="text-text-muted">{icon}</span>
        {label}
      </dt>
      <dd
        className={cn(
          'min-w-0 flex-1 truncate text-[11.5px] text-text-primary',
          mono && 'font-mono text-[11px]',
        )}
        title={value}
      >
        {value}
      </dd>
    </div>
  );
}

function Chip({ label }: { label: string }) {
  return (
    <span className="rounded-full border border-border px-1.5 py-0.5 font-mono text-[9.5px] tabular-nums text-text-muted">
      {label}
    </span>
  );
}
