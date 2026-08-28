export const WEBSITE_GUIDE_DOC_SLUG = "work-upload-guide";

export function GuideDocLink() {
  return (
    <p className="mt-2 border-t border-slate-200 pt-2">
      <a
        href={`/website/guide/${WEBSITE_GUIDE_DOC_SLUG}`}
        target="_blank"
        rel="noopener noreferrer"
        className="font-semibold text-apollon-700 underline decoration-apollon-300 underline-offset-2 hover:text-apollon-900"
      >
        자세한 규격은 제작 가이드에서 보기 ↗
      </a>
    </p>
  );
}
