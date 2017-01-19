---
title: 使用Transformations实现圆角或圆形图片
date: 2016-4-26 19:17:32
categories: Android
tags: 
    - Glide
---
## 简介

现在基本上每个应用的头像都是圆形，可是真实的图片却不是，需要我们自己处理，原来的处理方式是自定义ImageView或者使用第三方库，比如：[CircleImageView
](https://github.com/hdodenhof/CircleImageView)，但这里我们讲的是使用Glide来实现这样的效果，框架默认是没有提供这样的实现，但是这个框架提供了很灵活的框架，我们可以很方便的来自定义图片处理过程，[官方的教程在这里](https://github.com/bumptech/glide/wiki/Transformations)，他只是实现了Fit center和Center crop，这里就需要我们自定义

## 圆形图片

```java
package cn.woblog.testloadimage;

import android.content.Context;
import android.graphics.Bitmap;
import android.graphics.BitmapShader;
import android.graphics.Canvas;
import android.graphics.Paint;

import com.bumptech.glide.load.engine.bitmap_recycle.BitmapPool;
import com.bumptech.glide.load.resource.bitmap.BitmapTransformation;

/**
 * Created by ren on 2016/4/26 0026.
 */
public class CircleTransformation extends BitmapTransformation {
    public CircleTransformation(BitmapPool bitmapPool) {
        super(bitmapPool);
    }

    public CircleTransformation(Context context) {
        super(context);
    }

    @Override
    protected Bitmap transform(BitmapPool pool, Bitmap toTransform, int outWidth, int outHeight) {
        return circleCrop(pool, toTransform);
    }

    private Bitmap circleCrop(BitmapPool pool, Bitmap toTransform) {
        if (toTransform == null) return null;

        int size = Math.min(toTransform.getWidth(), toTransform.getHeight());
        int x = (toTransform.getWidth() - size) / 2;
        int y = (toTransform.getHeight() - size) / 2;

        // TODO this could be acquired from the pool too
        Bitmap squared = Bitmap.createBitmap(toTransform, x, y, size, size);

        Bitmap result = pool.get(size, size, Bitmap.Config.ARGB_8888);
        if (result == null) {
            result = Bitmap.createBitmap(size, size, Bitmap.Config.ARGB_8888);
        }

        Canvas canvas = new Canvas(result);
        Paint paint = new Paint();
        paint.setShader(new BitmapShader(squared, BitmapShader.TileMode.CLAMP, BitmapShader.TileMode.CLAMP));
        paint.setAntiAlias(true);
        float r = size / 2f;
        canvas.drawCircle(r, r, r, paint);
        return result;
    }

    @Override
    public String getId() {
        return getClass().getName();
    }
}
```

可以看到他会在transform方法中将bitmap传递给我们，那就简单了，我们只需要对他做一些处理，比如设置透明度。然后在返回

![](http://7qnc6h.com1.z0.glb.clouddn.com/cxetro4prtrfiqf8urfmhqm0od.png)

## 圆角图片

这个也简单啦，也是自定义Transformation来处理自己的逻辑

```java
package cn.woblog.testloadimage;

import android.content.Context;
import android.content.res.Resources;
import android.graphics.Bitmap;
import android.graphics.BitmapShader;
import android.graphics.Canvas;
import android.graphics.Paint;
import android.graphics.RectF;

import com.bumptech.glide.load.engine.bitmap_recycle.BitmapPool;
import com.bumptech.glide.load.resource.bitmap.BitmapTransformation;

/**
 * Created by ren on 2016/4/26 0026.
 */
public class RoundTransformation extends BitmapTransformation {
    private static float radius = 0f;

    public RoundTransformation(BitmapPool bitmapPool) {
        super(bitmapPool);
    }

    public RoundTransformation(Context context) {
        super(context);
    }

    public RoundTransformation(Context context,int radius) {
        super(context);
        this.radius = Resources.getSystem().getDisplayMetrics().density * radius;
    }



    @Override
    protected Bitmap transform(BitmapPool pool, Bitmap toTransform, int outWidth, int outHeight) {
        return roundCrop(pool, toTransform);
    }

    private Bitmap roundCrop(BitmapPool pool, Bitmap toTransform) {
        if (toTransform == null) return null;

        Bitmap result = pool.get(toTransform.getWidth(), toTransform.getHeight(), Bitmap.Config.ARGB_8888);
        if (result == null) {
            result = Bitmap.createBitmap(toTransform.getWidth(), toTransform.getHeight(), Bitmap.Config.ARGB_8888);
        }

        Canvas canvas = new Canvas(result);
        Paint paint = new Paint();
        paint.setShader(new BitmapShader(toTransform, BitmapShader.TileMode.CLAMP, BitmapShader.TileMode.CLAMP));
        paint.setAntiAlias(true);
        RectF rectF = new RectF(0f, 0f, toTransform.getWidth(), toTransform.getHeight());
        canvas.drawRoundRect(rectF, radius, radius, paint);
        return result;
    }



    @Override
    public String getId() {
        return getClass().getName().concat(String.valueOf(radius));
    }
}
```

可以看到其实还是很简单的，这个例子我们画圆角矩形就行了，上面那个例子自然就是画圆了。

![](http://7qnc6h.com1.z0.glb.clouddn.com/arh3uska0nvzpk9bu7d2r645qm.png)


到这里大家肯定会说，这个库太方便了，直接就可以用来做个相册并且是有特效那种的，比如：滤镜等，当然这种事啦，大神们早就想到了已经帮你实现好了[glide-transformations](https://github.com/wasabeef/glide-transformations)

还有一个库就是使用Glide加载图片时，可以很完美的使用Android Palette，参考这个库：[GlidePalette](https://github.com/florent37/GlidePalette)