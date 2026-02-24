import Link from 'next/link';

export default function NotFound() {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center gap-4">
      <h1 className="text-4xl font-bold text-white">404 - Not Found</h1>
      <p className="text-gray-400">The page you're looking for doesn't exist.</p>
      <Link href="/" className="px-6 py-3 bg-war-accent hover:bg-purple-600 text-white font-bold rounded-xl transition-colors">
        Go Home
      </Link>
    </div>
  );
}
