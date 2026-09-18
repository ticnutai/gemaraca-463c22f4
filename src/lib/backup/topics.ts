// Groups every table and storage bucket into user-facing topics for the backup panel.
// Tables are discovered live from the database (backup_catalog), so a table that is
// not listed here still gets backed up: it lands in the "other" topic.

export interface BackupTopic {
  id: string;
  label: string;
  description: string;
  tables: string[];
  buckets: string[];
}

export const BACKUP_TOPICS: BackupTopic[] = [
  {
    id: "psakim",
    label: "פסקי דין",
    description: "פסקי הדין, הסעיפים, שאלות נפוצות, תיקיות ותוצאות אינדקס חכם",
    tables: ["psakei_din", "psak_sections", "faq_items", "smart_index_results", "folder_categories"],
    buckets: [],
  },
  {
    id: "gemara",
    label: "גמרא ותוכן ש\"ס",
    description: "דפי גמרא, דוגמאות מודרניות, עריכות, סריקות ש\"ס והתקדמות הורדה",
    tables: ["gemara_pages", "modern_examples", "gemara_edit_snapshots", "shas_pdf_pages", "shas_download_progress"],
    buckets: [],
  },
  {
    id: "links",
    label: "קישורים ומראי מקומות",
    description: "הפניות תלמודיות, קישורי סוגיה-פסק וקישורי תבניות",
    tables: ["talmud_references", "sugya_psak_links", "pattern_sugya_links"],
    buckets: [],
  },
  {
    id: "notes",
    label: "הערות, סימונים ונעיצות",
    description: "הערות על PDF, סימוני טקסט ופריטים נעוצים",
    tables: ["pdf_annotations", "text_annotations", "user_pinned_items"],
    buckets: [],
  },
  {
    id: "books",
    label: "ספרים אישיים",
    description: "הספרים שהועלו ורשומותיהם",
    tables: ["user_books"],
    buckets: [],
  },
  {
    id: "settings",
    label: "הגדרות והעדפות",
    description: "העדפות משתמש, טיפוגרפיה ותבניות פרומפט",
    tables: ["user_preferences", "page_typography_settings", "user_prompt_templates"],
    buckets: [],
  },
  {
    id: "system",
    label: "מערכת והרשאות",
    description: "הרשאות, היסטוריית מיגרציות, לוגים וסשנים של העלאה",
    tables: ["user_roles", "migration_history", "function_logs", "upload_sessions"],
    buckets: [],
  },
  {
    id: "files",
    label: "קבצים (אחסון)",
    description: "קבצי פסקי הדין, סריקות ש\"ס וספרים שהועלו",
    tables: [],
    buckets: ["psakei-din-files", "shas-pdf-pages", "user-books"],
  },
];

export const OTHER_TOPIC: BackupTopic = {
  id: "other",
  label: "אחר",
  description: "טבלאות וקבצים חדשים שעוד לא שויכו לנושא",
  tables: [],
  buckets: [],
};

export const TABLE_LABELS: Record<string, string> = {
  psakei_din: "פסקי דין",
  psak_sections: "סעיפי פסקים",
  faq_items: "שאלות נפוצות",
  smart_index_results: "אינדקס חכם",
  folder_categories: "תיקיות",
  gemara_pages: "דפי גמרא",
  modern_examples: "דוגמאות מודרניות",
  gemara_edit_snapshots: "עריכות גמרא",
  shas_pdf_pages: "סריקות ש\"ס (רשומות)",
  shas_download_progress: "התקדמות הורדת ש\"ס",
  talmud_references: "הפניות תלמודיות",
  sugya_psak_links: "קישורי סוגיה-פסק",
  pattern_sugya_links: "קישורי תבניות",
  pdf_annotations: "הערות PDF",
  text_annotations: "סימוני טקסט",
  user_pinned_items: "פריטים נעוצים",
  user_books: "ספרים אישיים",
  user_preferences: "העדפות משתמש",
  page_typography_settings: "הגדרות טיפוגרפיה",
  user_prompt_templates: "תבניות פרומפט",
  user_roles: "הרשאות משתמשים",
  migration_history: "היסטוריית מיגרציות",
  function_logs: "לוגים של פונקציות",
  upload_sessions: "סשנים של העלאה",
};

export const BUCKET_LABELS: Record<string, string> = {
  "psakei-din-files": "קבצי פסקי דין",
  "shas-pdf-pages": "סריקות ש\"ס (PDF)",
  "user-books": "קבצי ספרים אישיים",
};

export const tableLabel = (name: string) => TABLE_LABELS[name] ?? name;
export const bucketLabel = (id: string) => BUCKET_LABELS[id] ?? id;

/** Topics with the live tables/buckets resolved; unknown ones go to "other". Empty topics are dropped. */
export function resolveTopics(tables: string[], buckets: string[]): BackupTopic[] {
  const tableSet = new Set(tables);
  const bucketSet = new Set(buckets);
  const claimedTables = new Set<string>();
  const claimedBuckets = new Set<string>();

  const topics = BACKUP_TOPICS.map((t) => {
    const ts = t.tables.filter((x) => tableSet.has(x));
    const bs = t.buckets.filter((x) => bucketSet.has(x));
    ts.forEach((x) => claimedTables.add(x));
    bs.forEach((x) => claimedBuckets.add(x));
    return { ...t, tables: ts, buckets: bs };
  });

  const other: BackupTopic = {
    ...OTHER_TOPIC,
    tables: tables.filter((x) => !claimedTables.has(x)),
    buckets: buckets.filter((x) => !claimedBuckets.has(x)),
  };

  return [...topics, other].filter((t) => t.tables.length + t.buckets.length > 0);
}

/** Topic ids that contain any of the given tables/buckets (for labelling a backup). */
export function topicsFor(tables: string[], buckets: string[]): string[] {
  const all = resolveTopics(tables, buckets);
  return all.map((t) => t.id);
}

export function topicLabel(id: string): string {
  return [...BACKUP_TOPICS, OTHER_TOPIC].find((t) => t.id === id)?.label ?? id;
}
