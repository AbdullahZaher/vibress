import Link from "next/link";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "404 - Page not found",
  description: "The page you are looking for does not exist.",
};

export default function NotFound() {
  return (
    <div className="vb-not-found-screen">
      <div className="vb-not-found-box">
        <h1 className="vb-not-found-title">404</h1>
        <p className="vb-not-found-subtitle">Page not found</p>
        <Link href="/" className="vb-not-found-link">
          Go to the front page <span className="vb-not-found-arrow">→</span>
        </Link>
      </div>

      <style>{`
        .vb-not-found-screen {
          position: fixed;
          inset: 0;
          width: 100vw;
          height: 100vh;
          background-color: #ffffff;
          display: flex;
          align-items: center;
          justify-content: center;
          z-index: 99999;
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Oxygen, Ubuntu, Cantarell, "Open Sans", "Helvetica Neue", sans-serif;
          margin: 0;
          padding: 0;
          box-sizing: border-box;
        }

        .vb-not-found-box {
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          text-align: center;
          user-select: none;
          transform: translateY(-2vh);
        }

        .vb-not-found-title {
          font-size: clamp(100px, 14vw, 150px);
          font-weight: 700;
          line-height: 1;
          color: #bccad6;
          letter-spacing: -0.01em;
          margin: 0 0 16px 0;
        }

        .vb-not-found-subtitle {
          font-size: 22px;
          font-weight: 500;
          color: #3b4247;
          margin: 0 0 10px 0;
          letter-spacing: -0.01em;
        }

        .vb-not-found-link {
          font-size: 14.5px;
          font-weight: 500;
          color: #3882e5;
          text-decoration: none;
          display: inline-flex;
          align-items: center;
          gap: 4px;
          transition: color 0.15s ease, opacity 0.15s ease;
        }

        .vb-not-found-link:hover {
          color: #2062b8;
          text-decoration: underline;
        }

        .vb-not-found-arrow {
          font-family: "Segoe UI", -apple-system, BlinkMacSystemFont, sans-serif;
          display: inline-block;
          transition: transform 0.15s ease;
        }

        .vb-not-found-link:hover .vb-not-found-arrow {
          transform: translateX(3px);
        }
      `}</style>
    </div>
  );
}
