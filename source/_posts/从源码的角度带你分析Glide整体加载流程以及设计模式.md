---
title: 从源码的角度带你分析Glide整体加载流程以及设计模式
date: 2016-5-6 11:27:40
categories: Android
tags: 
    - Glide
---
## 基本调用流程

这一篇文章我们从源码的角度分析Glide实现，首先我们从一句最简单的使用方式来探索他的设计与实现，可以看到下面这句话是最基础的使用

```java
Glide.with(this)
        .load(R.raw.large_giphy_logo)
        .into(giphyLogoView);
```

接下来我们一步一步的跟踪他的调用过程，首先我们看到他调用了Glide的with方法并传入了自己的引用，我们可以看到这方法的实现如下：
```java
public static RequestManager with(Activity activity) {
  RequestManagerRetriever retriever = RequestManagerRetriever.get();
  return retriever.get(activity);
}
```
他调用了RequestManagerRetriever的方法获取了一个RequestManagerRetriever然后在调用get方法获取了一个RequestManager，到这里我们大概基本明白了with方法做的是将当前引用（Activity，Fragment）传递进去并获取一个和当前引用绑定的RequestManager，到这里大家应该能明白了为什么说Glide绑定了界面的生命周期了吧

接着调用了RequestManager的load方法，可以看到这一步创建了RequestBuilder

```java
public RequestBuilder<Drawable> load(@Nullable Object model) {
  return asDrawable().load(model);
}
```
最后调用到了loadGeneric方法

```java
public RequestBuilder<TranscodeType> load(@Nullable Object model) {
  return loadGeneric(model);
}
```

不过从这个方法我们可以看到他只是将传递进来的资源保存了，现在还没有发送真正的网络请求
```java
private RequestBuilder<TranscodeType> loadGeneric(@Nullable Object model) {
  this.model = model;
  isModelSet = true;
  return this;
}
```

然后调用了RequestBuilder的into方法
```java
public Target<TranscodeType> into(ImageView view) {
    Util.assertMainThread();
    Preconditions.checkNotNull(view);

    if (!requestOptions.isTransformationSet()
            && requestOptions.isTransformationAllowed()
            && view.getScaleType() != null) {
        if (requestOptions.isLocked()) {
            requestOptions = requestOptions.clone();
        }
        switch (view.getScaleType()) {
            case CENTER_CROP:
                requestOptions.optionalCenterCrop(context);
                break;
            case CENTER_INSIDE:
                requestOptions.optionalCenterInside(context);
                break;
            case FIT_CENTER:
            case FIT_START:
            case FIT_END:
                requestOptions.optionalFitCenter(context);
                break;
            //$CASES-OMITTED$
            default:
                // Do nothing.
        }
    }

    return into(context.buildImageViewTarget(view, transcodeClass));
}
```

在这个方法里面，主要判断了是否设置了Transformation如果设置了，然后根据相应的规则变换bitmap，最后调用了这个into方法
```java
public <Y extends Target<TranscodeType>> Y into(@NonNull Y target) {
    Util.assertMainThread();
    Preconditions.checkNotNull(target);
    if (!isModelSet) {
        throw new IllegalArgumentException("You must call #load() before calling #into()");
    }

    Request previous = target.getRequest();

    if (previous != null) {
        requestManager.clear(target);
    }

    requestOptions.lock();
    Request request = buildRequest(target);
    target.setRequest(request);
    requestManager.track(target, request);

    return target;
}
```
在这方法中创建了Request，然后调用requestManager的track方法去执行这个request
```java
void track(Target<?> target, Request request) {
    targetTracker.track(target);
    requestTracker.runRequest(request);
  }
```
  
  我们再来查看下buildRequest方法
  
```java  
  private Request buildRequest(Target<TranscodeType> target) {
    return buildRequestRecursive(target, null, transitionOptions, requestOptions.getPriority(),
            requestOptions.getOverrideWidth(), requestOptions.getOverrideHeight());
}

private Request buildRequestRecursive(Target<TranscodeType> target,
                                      @Nullable ThumbnailRequestCoordinator parentCoordinator,
                                      TransitionOptions<?, ? super TranscodeType> transitionOptions,
                                      Priority priority, int overrideWidth, int overrideHeight) {
    if (thumbnailBuilder != null) {
        // Recursive case: contains a potentially recursive thumbnail request builder.
        if (isThumbnailBuilt) {
            throw new IllegalStateException("You cannot use a request as both the main request and a "
                    + "thumbnail, consider using clone() on the request(s) passed to thumbnail()");
        }

        TransitionOptions<?, ? super TranscodeType> thumbTransitionOptions =
                thumbnailBuilder.transitionOptions;
        if (DEFAULT_ANIMATION_OPTIONS.equals(thumbTransitionOptions)) {
            thumbTransitionOptions = transitionOptions;
        }

        Priority thumbPriority = thumbnailBuilder.requestOptions.isPrioritySet()
                ? thumbnailBuilder.requestOptions.getPriority() : getThumbnailPriority(priority);

        int thumbOverrideWidth = thumbnailBuilder.requestOptions.getOverrideWidth();
        int thumbOverrideHeight = thumbnailBuilder.requestOptions.getOverrideHeight();
        if (Util.isValidDimensions(overrideWidth, overrideHeight)
                && !thumbnailBuilder.requestOptions.isValidOverride()) {
            thumbOverrideWidth = requestOptions.getOverrideWidth();
            thumbOverrideHeight = requestOptions.getOverrideHeight();
        }

        ThumbnailRequestCoordinator coordinator = new ThumbnailRequestCoordinator(parentCoordinator);
        Request fullRequest = obtainRequest(target, requestOptions, coordinator,
                transitionOptions, priority, overrideWidth, overrideHeight);
        isThumbnailBuilt = true;
        // Recursively generate thumbnail requests.
        Request thumbRequest = thumbnailBuilder.buildRequestRecursive(target, coordinator,
                thumbTransitionOptions, thumbPriority, thumbOverrideWidth, thumbOverrideHeight);
        isThumbnailBuilt = false;
        coordinator.setRequests(fullRequest, thumbRequest);
        return coordinator;
    } else if (thumbSizeMultiplier != null) {
        // Base case: thumbnail multiplier generates a thumbnail request, but cannot recurse.
        ThumbnailRequestCoordinator coordinator = new ThumbnailRequestCoordinator(parentCoordinator);
        Request fullRequest = obtainRequest(target, requestOptions, coordinator, transitionOptions,
                priority, overrideWidth, overrideHeight);
        BaseRequestOptions<?> thumbnailOptions = requestOptions.clone()
                .sizeMultiplier(thumbSizeMultiplier);

        Request thumbnailRequest = obtainRequest(target, thumbnailOptions, coordinator,
                transitionOptions, getThumbnailPriority(priority), overrideWidth, overrideHeight);

        coordinator.setRequests(fullRequest, thumbnailRequest);
        return coordinator;
    } else {
        // Base case: no thumbnail.
        return obtainRequest(target, requestOptions, parentCoordinator, transitionOptions, priority,
                overrideWidth, overrideHeight);
    }
}
```

可以看到最后调用了buildRequestRecursive来创建一个Request，在这方法里面通过判断是否设置了thumbnail来创建不同类型的Request，如果没有设置就会创建最基本的请求，也就是SingleRequest
```java
private Request obtainRequest(Target<TranscodeType> target,
                              BaseRequestOptions<?> requestOptions, RequestCoordinator requestCoordinator,
                              TransitionOptions<?, ? super TranscodeType> transitionOptions, Priority priority,
                              int overrideWidth, int overrideHeight) {
    requestOptions.lock();

    return SingleRequest.obtain(
            context,
            model,
            transcodeClass,
            requestOptions,
            overrideWidth,
            overrideHeight,
            priority,
            target,
            requestListener,
            requestCoordinator,
            context.getEngine(),
            transitionOptions.getTransitionFactory());
}
```

到这里大家可以看到Glide的源码可以说是非常复杂的，总感觉有时候用到项目里是不是有点太重了，就加载个图片，你看看搞了这么多代码~~

## 一些设计技巧

### 绑定界面的生命周期

在Glide中可以看到所有的请求都是和当前界面绑定的，比如：activity执行onStop时，其相应的请求应该暂停，那他是怎么绑定的呢，简单来讲就是在当前activity中绑定一个fragment，这样我们就能通过这个fragment获取到相应的生命周期，然后回调到你要处理的地方，然后在作出相应的处理，如果代码：

```java
@TargetApi(Build.VERSION_CODES.HONEYCOMB)
private void bindLifeCycle(LifeCycleActivity activity) {
    FragmentManager fm = activity.getFragmentManager();
    //将一个fragment绑定到当前界面，这样就能获取到了当前界面的生命周期了
    LifeCycleFragment current = new LifeCycleFragment();
    fm.beginTransaction().add(current, FRAGMENT_TAG).commitAllowingStateLoss();
}
```

这样我们就能在LifeCycleFragment中获取到相应的生命周期了

```java
@TargetApi(Build.VERSION_CODES.HONEYCOMB)
public class LifeCycleFragment extends Fragment {
    private static final String TAG = "LifeCycleFragment";

    @Override
    public void onStart() {
        super.onStart();
        //TODO 这里回调你的生命周期状态
        Log.d(TAG,"onStart");
    }

    @Override
    public void onStop() {
        super.onStop();
        Log.d(TAG,"onStop");
    }

    @Override
    public void onDestroy() {
        super.onDestroy();
        Log.d(TAG,"onDestroy");
    }
}
```

参考：https://github.com/android-cn/android-open-project-analysis/tree/master/tool-lib/image-cache/glide