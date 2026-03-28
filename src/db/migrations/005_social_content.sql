-- Migracja 005: Social content i blog

CREATE TABLE IF NOT EXISTS social_posts (
    id SERIAL PRIMARY KEY,
    title VARCHAR(300),
    content TEXT NOT NULL,
    hashtags TEXT,
    category VARCHAR(50),
    post_type VARCHAR(30) DEFAULT 'trend',
    image_prompt TEXT,
    source VARCHAR(50) DEFAULT 'SocialContentAgent',
    published BOOLEAN DEFAULT false,
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_social_posts_created ON social_posts(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_social_posts_type ON social_posts(post_type);

CREATE TABLE IF NOT EXISTS blog_articles (
    id SERIAL PRIMARY KEY,
    title VARCHAR(500) NOT NULL,
    slug VARCHAR(200),
    content TEXT NOT NULL,
    excerpt TEXT,
    category VARCHAR(50),
    tags TEXT,
    source VARCHAR(50) DEFAULT 'ContentAgent',
    published BOOLEAN DEFAULT false,
    views INTEGER DEFAULT 0,
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_blog_articles_slug ON blog_articles(slug);
CREATE INDEX IF NOT EXISTS idx_blog_articles_created ON blog_articles(created_at DESC);

CREATE TABLE IF NOT EXISTS email_subscribers (
    id SERIAL PRIMARY KEY,
    email VARCHAR(255) UNIQUE NOT NULL,
    name VARCHAR(200),
    source VARCHAR(50) DEFAULT 'website',
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_email_subscribers_active ON email_subscribers(is_active);
