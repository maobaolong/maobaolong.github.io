---
title: 深入Glide图片加载库的Demo源码分析
date: 2016-4-25 19:43:12
categories: Android
tags: 
    - Glide
---
## 简介

上一篇我们聊了怎么运行官方的示例和一些基本使用，这一篇我们要学习下Glide库中自带的几个Demo，并深入学习下，其中的配置和一些高级使用

### Gallery

首先我们来分析下Gallery这个demo工程，我们先看看他的结构：

![](http://7qnc6h.com1.z0.glb.clouddn.com/kg844wimpy0evjefbfcitu6tdf.png)

我们通过清单文件可以看到主界面是MainActivity，好的那我们打开看看啦，可以看到只是在onCreate方法中添加了如下代码：

```java
Glide.get(this).setMemoryCategory(MemoryCategory.HIGH);
```

他用来动态调整内存，可以看到代码最终实现在LruBitmapPool类中：

```java
@Override
public synchronized void setSizeMultiplier(float sizeMultiplier) {
  maxSize = Math.round(initialMaxSize * sizeMultiplier);
  evict();
}
```

可以看到会把我们传进来的值和初始大小相乘，然后调用evict方法处理剩余的逻辑，他有调用了trimToSize(maxSize)，在这个方法中才真正开始处理逻辑

```java
private synchronized void trimToSize(int size) {
    while (currentSize > size) { //如果当前值大于最大值
        final Bitmap removed = strategy.removeLast();//移除最后一个，依次内推，知道当前值小于最大值时停止
        // TODO: This shouldn't ever happen, see #331.
        if (removed == null) {
            if (Log.isLoggable(TAG, Log.WARN)) {
                Log.w(TAG, "Size mismatch, resetting");
                dumpUnchecked();
            }
            currentSize = 0;
            return;
        }

        tracker.remove(removed);
        currentSize -= strategy.getSize(removed);
        removed.recycle();
        evictions++;
        if (Log.isLoggable(TAG, Log.DEBUG)) {
            Log.d(TAG, "Evicting bitmap=" + strategy.logBitmap(removed));
        }
        dump();
    }
}
```

好了，主界面基本没什么说的了，因为他就嵌入一个Fragment，叫HorizontalGalleryFragment，我们来看看他的实现吧：

可以看到他在onCreate方法中使用了LoaderManager来加载手机里面的媒体，并封装成MediaStoreData类

```java
getLoaderManager().initLoader(R.id.loader_id_media_store_data, null, this);
```

然后在onCreateLoader中创建了我们自定义的Loader，让他去加载我们需要的内容，代码如下：

```java
@Override
public Loader<List<MediaStoreData>> onCreateLoader(int i, Bundle bundle) {
  return new MediaStoreDataLoader(getActivity());
}
```

当Loader加载完数据后就会调用onLoadFinished，并将需要的数据传给你，在这里可以设置到adapter等

```java
@Override
public void onLoadFinished(Loader<List<MediaStoreData>> loader,
    List<MediaStoreData> mediaStoreData) {
  RequestManager requestManager = Glide.with(this);
  RecyclerAdapter adapter =
      new RecyclerAdapter(getActivity(), mediaStoreData, requestManager);
  RecyclerViewPreloader<MediaStoreData> preloader =
      new RecyclerViewPreloader<>(requestManager, adapter, adapter, 3);
  recyclerView.addOnScrollListener(preloader);
  recyclerView.setAdapter(adapter);
}
```

可以看到这里使用了RecyclerViewPreloader来预加载媒体，想要深入的可以查看Demo源码，另外附上一段在getView方法中获取view的宽高方法

```java
if (actualDimensions == null) {
  view.getViewTreeObserver().addOnPreDrawListener(new ViewTreeObserver.OnPreDrawListener() {
    @Override
    public boolean onPreDraw() {
      if (actualDimensions == null) {
        actualDimensions = new int[] { view.getWidth(), view.getHeight() };
      }
      view.getViewTreeObserver().removeOnPreDrawListener(this);
      return true;
    }
  });
}
```

最后来一张这个Demo运行的截图

![](http://7qnc6h.com1.z0.glb.clouddn.com/fd90w13mbihpvsj5cnirh1cwka.png)

下载来分析一个，另外一个Demo了

### giphy

> Giphy是一个动图搜索引擎，被誉为 “GIF 中的 Google”。
> Giphy 创建以来做了很多尝试，比如提供"live GIFing（实况 GIF）"工具帮媒体和内容出版者在自己的内容中快速添加动图，在直播发布会时非常
> 好使。不过最有趣的还是 Giphy 能集成到 Slack 和 Facebook Messenger 等聊天应用中，也可以直接添加到 Twitter 和 Facebook 等社交媒体的内容中。

这是来自百科的说明，而这个demo就是基于他显示gif的一个应用，首先来一张效果图，因为我们截图，所以不会动啦~

![](http://7qnc6h.com1.z0.glb.clouddn.com/n2ez18hnqe2hjvyhg36vjm8rja.png)

首先这个Demo主要讲的就是配置GlideModules，首先我们要说明的就是这里为什么要配置GlideModules，因为在这个示例中我们想实现的是效果是，用户在不同的分辨率下，显示不同的图片，就这么简单，下面是Demo里面请求接口返回的数据，可以看到他返回了很多种类型，有固定宽度的，有固定高度的等

![](http://7qnc6h.com1.z0.glb.clouddn.com/liuthi2vlt1kbu638iyk7ti9vy.png)

那怎么来实现这样的需求呢，答案肯定是要自定义BaseGlideUrlLoader，然后在getUrl方法里面处理，这个方法返回一个url，就是最终图片显示的url

GiphyGlideModule.java

```java
package com.bumptech.glide.samples.giphy;

import android.content.Context;

import com.bumptech.glide.GlideBuilder;
import com.bumptech.glide.Registry;
import com.bumptech.glide.module.GlideModule;

import java.io.InputStream;

/**
 * {@link com.bumptech.glide.module.GlideModule} implementation for the Giphy sample app.
 */
public class GiphyGlideModule implements GlideModule {
  @Override
  public void applyOptions(Context context, GlideBuilder builder) {
    // Do nothing.
  }

  @Override
  public void registerComponents(Context context, Registry registry) {
    registry.append(Api.GifResult.class, InputStream.class, new GiphyModelLoader.Factory()); //这里一定要注册
  }
}
```

上面这个可以说是一个全局配置吧，比如：缓存位置，缓存大小等通用设置可以直接在applyOptions里面设置

GiphyModelLoader.java

```java
package com.bumptech.glide.samples.giphy;

import android.content.Context;
import android.text.TextUtils;

import com.bumptech.glide.load.Options;
import com.bumptech.glide.load.model.GlideUrl;
import com.bumptech.glide.load.model.ModelLoader;
import com.bumptech.glide.load.model.ModelLoaderFactory;
import com.bumptech.glide.load.model.MultiModelLoaderFactory;
import com.bumptech.glide.load.model.stream.BaseGlideUrlLoader;

import java.io.InputStream;

/**
 * A model loader that translates a POJO mirroring a JSON object representing a single image from
 * Giphy's api into an {@link java.io.InputStream} that can be decoded into an
 * {@link android.graphics.drawable.Drawable}.
 */
public class GiphyModelLoader extends BaseGlideUrlLoader<Api.GifResult> {

  @Override
  public boolean handles(Api.GifResult model) {
    return true;
  }

  /**
   * The default factory for {@link com.bumptech.glide.samples.giphy.GiphyModelLoader}s.
   */
  public static class Factory implements ModelLoaderFactory<Api.GifResult, InputStream> {


    @Override
    public ModelLoader<Api.GifResult, InputStream> build(Context context,
        MultiModelLoaderFactory multiFactory) {
      return new GiphyModelLoader(multiFactory.build(GlideUrl.class, InputStream.class));
    }

    @Override
    public void teardown() {
      // Do nothing.
    }
  }

  public GiphyModelLoader(ModelLoader<GlideUrl, InputStream> urlLoader) {
    super(urlLoader);
  }

  @Override
  protected String getUrl(Api.GifResult model, int width, int height, Options options) {
    Api.GifImage fixedHeight = model.images.fixed_height;
    int fixedHeightDifference = getDifference(fixedHeight, width, height);
    Api.GifImage fixedWidth = model.images.fixed_width;
    int fixedWidthDifference = getDifference(fixedWidth, width, height);
    if (fixedHeightDifference < fixedWidthDifference && !TextUtils.isEmpty(fixedHeight.url)) {
      return fixedHeight.url;
    } else if (!TextUtils.isEmpty(fixedWidth.url)) {
      return fixedWidth.url;
    } else if (!TextUtils.isEmpty(model.images.original.url)) {
      return model.images.original.url;
    } else {
      return null;
    }
  }

  private static int getDifference(Api.GifImage gifImage, int width, int height) {
    return Math.abs(width - gifImage.width) + Math.abs(height - gifImage.height);
  }
}
```

可以看到在上面的getUrl方法中处理了不同的分辨率然后返回不同的url。但是问题来了现在的图片CDN都提供缩略图功能，那么基于这种需求，大家觉得怎么实现好呢，欢迎评论留言讨论~~

现在最重要的部分来了，虽然我自定义了，但Glide肯定还不知道呀，那怎么才能让他知道呢。答案是的配置，没错：

清单文件：

```xml
<meta-data
    android:name="com.bumptech.glide.samples.giphy.GiphyGlideModule"
    android:value="GlideModule"/>
```


### flickr

> Flickr，雅虎旗下图片分享网站。为一家提供免费及付费数位照片储存、分享方案之线上服务，也提供网络社群服务的平台

Demo分析就说道这里吧，下一篇说说Glide核心源码部分，感谢你的观看~~
