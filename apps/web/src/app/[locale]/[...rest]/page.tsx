import { notFound } from 'next/navigation';

/** Any unknown path under a language renders the localized 404 page (with the site header and footer). */
export default function CatchAll() {
  notFound();
}
