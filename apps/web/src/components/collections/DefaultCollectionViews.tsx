import React from "react";
import Link from "next/link";
import { CollectionEntryViewModel, SiteViewModel } from "@vibress/theme-core";

export interface DefaultCollectionViewProps {
  model: {
    name: string;
    slug: string;
    description?: string | null | undefined;
  };
  entries: CollectionEntryViewModel[];
  site: SiteViewModel;
  settings?: Record<string, unknown> | undefined;
  pagination?: {
    limit: number;
    offset: number;
    count: number;
  } | undefined;
}

export function DefaultCollectionView({
  model,
  entries,
  site,
  pagination,
}: DefaultCollectionViewProps) {
  return (
    <div className="max-w-5xl mx-auto px-4 py-12">
      <header className="mb-10 pb-6 border-b border-gray-200 dark:border-gray-800">
        <nav className="mb-4 text-sm text-gray-500">
          <Link href="/" className="hover:underline">
            {site.title || "Home"}
          </Link>
          <span className="mx-2">/</span>
          <span className="text-gray-800 dark:text-gray-200 font-medium">
            {model.name}
          </span>
        </nav>
        <h1 className="text-3xl sm:text-4xl font-extrabold tracking-tight text-gray-900 dark:text-white">
          {model.name}
        </h1>
        {model.description && (
          <p className="mt-2 text-lg text-gray-600 dark:text-gray-400">
            {model.description}
          </p>
        )}
      </header>

      {entries.length === 0 ? (
        <div className="text-center py-16 bg-gray-50 dark:bg-gray-900 rounded-xl border border-dashed border-gray-300 dark:border-gray-800">
          <p className="text-gray-500 dark:text-gray-400 text-lg">
            No entries published yet in this collection.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {entries.map((entry) => (
            <article
              key={entry.id}
              className="flex flex-col bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 hover:shadow-lg transition-shadow overflow-hidden"
            >
              <div className="p-6 flex-1 flex flex-col justify-between">
                <div>
                  <h2 className="text-xl font-bold text-gray-900 dark:text-white hover:text-blue-600 dark:hover:text-blue-400 transition-colors">
                    <Link href={`/collections/${model.slug}/${entry.slug}`}>
                      {entry.title}
                    </Link>
                  </h2>
                  <div className="mt-3 space-y-2 text-sm text-gray-600 dark:text-gray-300">
                    {Object.entries(entry.data || {}).slice(0, 4).map(([k, v]) => {
                      if (v === null || v === undefined || typeof v === "object") return null;
                      return (
                        <div key={k} className="flex justify-between gap-2">
                          <span className="font-medium text-gray-500 capitalize">{k.replace(/_/g, " ")}:</span>
                          <span className="truncate max-w-[60%]">{String(v)}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
                <div className="mt-6 pt-4 border-t border-gray-100 dark:border-gray-800 flex items-center justify-between">
                  <span className="text-xs text-gray-400">
                    {entry.publishedAt ? new Date(entry.publishedAt).toLocaleDateString() : ""}
                  </span>
                  <Link
                    href={`/collections/${model.slug}/${entry.slug}`}
                    className="text-sm font-semibold text-blue-600 dark:text-blue-400 hover:underline"
                  >
                    View Details &rarr;
                  </Link>
                </div>
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}

export interface DefaultCollectionEntryViewProps {
  model: {
    name: string;
    slug: string;
  };
  entry: CollectionEntryViewModel;
  site: SiteViewModel;
  settings?: Record<string, unknown> | undefined;
}

export function DefaultCollectionEntryView({
  model,
  entry,
  site,
}: DefaultCollectionEntryViewProps) {
  return (
    <article className="max-w-4xl mx-auto px-4 py-12">
      <nav className="mb-6 text-sm text-gray-500">
        <Link href="/" className="hover:underline">
          {site.title || "Home"}
        </Link>
        <span className="mx-2">/</span>
        <Link href={`/collections/${model.slug}`} className="hover:underline capitalize">
          {model.name}
        </Link>
        <span className="mx-2">/</span>
        <span className="text-gray-800 dark:text-gray-200 font-medium">
          {entry.title}
        </span>
      </nav>

      <header className="mb-8">
        <h1 className="text-3xl sm:text-5xl font-extrabold tracking-tight text-gray-900 dark:text-white">
          {entry.title}
        </h1>
        {entry.publishedAt && (
          <p className="mt-2 text-sm text-gray-500">
            Published on {new Date(entry.publishedAt).toLocaleDateString()}
          </p>
        )}
      </header>

      <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 p-6 sm:p-8 shadow-sm">
        <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-6">
          {Object.entries(entry.data || {}).map(([key, val]) => {
            if (val === null || val === undefined) return null;
            return (
              <div key={key} className="border-b border-gray-100 dark:border-gray-800 pb-4">
                <dt className="text-xs font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500">
                  {key.replace(/_/g, " ")}
                </dt>
                <dd className="mt-1 text-base font-medium text-gray-900 dark:text-gray-100">
                  {typeof val === "object" ? (
                    <pre className="text-xs bg-gray-50 dark:bg-gray-800 p-2 rounded overflow-auto">
                      {JSON.stringify(val, null, 2)}
                    </pre>
                  ) : typeof val === "boolean" ? (
                    <span>{val ? "Yes" : "No"}</span>
                  ) : (
                    <span>{String(val)}</span>
                  )}
                </dd>
              </div>
            );
          })}
        </dl>
      </div>
    </article>
  );
}
