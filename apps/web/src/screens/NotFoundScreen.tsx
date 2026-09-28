import { Link } from 'react-router';
import { TopBar } from '../components/TopBar';
import { FEED_PATH } from '../routes';

export function NotFoundScreen({ what = 'page' }: { what?: string }) {
  return (
    <div className="flex min-h-screen flex-col">
      <TopBar current="feed">{null}</TopBar>
      <main className="flex flex-1 flex-col p-3">
        <section className="flex flex-col items-start gap-2 rounded-panel border border-border bg-panel px-[22px] py-[18px]">
          <h1 className="text-[15px] font-extrabold">No {what} here</h1>
          <p className="text-[13px] text-text-2">The link may be out of date.</p>
          <Link
            to={FEED_PATH}
            className="flex h-11 items-center text-[13px] font-bold text-supplier-light underline-offset-2 hover:underline"
          >
            Back to your feed
          </Link>
        </section>
      </main>
    </div>
  );
}
