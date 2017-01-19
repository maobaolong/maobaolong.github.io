title: 两个surfaceview的重叠效果类似直播效果中的视频和讲义实践
date: 2016-6-4 19:13:39
categories: Android
tags:
  - SurfaceView
---
[TOC]

## 效果图

首先还是不废话，直接上一张图，有图才有真相，不然大家看半天才发现不是我想要的效果，所以这样浪费大家的时间了

![](http://7qnc6h.com1.z0.glb.clouddn.com/test-surface.gif)

实际应用场景可多了，比如后面是显示相机的数据，前面是一个画板，直播的视频和讲义展示

## 布局

布局就很简单了，直接让两个surfaceView重叠在一起

```xml
<?xml version="1.0" encoding="utf-8"?>
<RelativeLayout xmlns:android="http://schemas.android.com/apk/res/android"
    xmlns:tools="http://schemas.android.com/tools"
    android:layout_width="match_parent"
    android:layout_height="match_parent"
    android:background="#00f"
    tools:context="cn.woblog.testsurfaceview.MainActivity">

    <SurfaceView
        android:id="@+id/sv"
        android:layout_width="match_parent"
        android:layout_height="400dp" />

    <RelativeLayout
        android:id="@+id/rl"
        android:layout_width="wrap_content"
        android:layout_height="wrap_content">

        <SurfaceView
            android:id="@+id/sv_mini"
            android:layout_width="200dp"
            android:layout_height="200dp"
            android:clickable="false"
            android:focusable="false" />
    </RelativeLayout>
</RelativeLayout>
```

## 添加要显示的内容

我这里为了测试就没有播放视频或者使用摄像头的数据，而是直接画了一个颜色上去，但是道理都是一样的

```java
sv = (SurfaceView) findViewById(R.id.sv);
sfh = sv.getHolder();
        //对 surfaceView 进行操作
        sfh.addCallback(new SurfaceHolder.Callback() {
            @Override
            public void surfaceCreated(SurfaceHolder holder) {
                Canvas c = sfh.lockCanvas(new Rect(0, 0, 600, 600));
                //2.开画
                Paint p = new Paint();
                p.setColor(Color.RED);
                Rect aa = new Rect(0, 0, 600, 600);
                c.drawRect(aa, p);
                //3. 解锁画布   更新提交屏幕显示内容
                sfh.unlockCanvasAndPost(c);
            }

            @Override
            public void surfaceChanged(SurfaceHolder holder, int format, int width, int height) {

            }

            @Override
            public void surfaceDestroyed(SurfaceHolder holder) {

            }
        });
```

如果到这一步，这两个界面肯定是不会有上图的效果，而是第一个会覆盖第二个，下面是关键代码了

```java
sv_mini.setZOrderOnTop(true);
holder.setFormat(PixelFormat.TRANSPARENT);
```

把最上面的那个surface设置为最上面，并且然他透明，如果不设置透明，那么只能看到顶部的那个surfaceView，其他地方是黑色的。到这里基本解决了然两个surfaceView重叠显示，下面我们来加入拖动效果

## 使用layout方法

```java
@TargetApi(Build.VERSION_CODES.HONEYCOMB)
@Override
public boolean onTouch(View v, MotionEvent event) {
    int ea = event.getAction();
    switch (ea) {
        case MotionEvent.ACTION_DOWN:
            lastX = (int) event.getRawX();
            lastY = (int) event.getRawY();
            break;
        /**
         * layout(l,t,r,b)
         * l  Left position, relative to parent
         t  Top position, relative to parent
         r  Right position, relative to parent
         b  Bottom position, relative to parent
         * */
        case MotionEvent.ACTION_MOVE:
            int dx = (int) event.getRawX() - lastX;
            int dy = (int) event.getRawY() - lastY;

            int left = v.getLeft() + dx;
            int top = v.getTop() + dy;
            int right = v.getRight() + dx;
            int bottom = v.getBottom() + dy;

            if (left < 0) {
                left = 0;
                right = left + v.getWidth();
            }

            if (right > screenWidth) {
                right = screenWidth;
                left = right - v.getWidth();
            }

            if (top < 0) {
                top = 0;
                bottom = top + v.getHeight();
            }

            if (bottom > screenHeight) {
                bottom = screenHeight;
                top = bottom - v.getHeight();
            }

            v.layout(left, top, right, bottom);

            Log.i("", "position：" + left + ", " + top + ", " + right + ", " + bottom);

            lastX = (int) event.getRawX();
            lastY = (int) event.getRawY();

            break;
        case MotionEvent.ACTION_UP:
            break;
    }
    return true;
}
```

## 使用margin

带添加~

## 完整代码

```java
package cn.woblog.testsurfaceview;

import android.annotation.TargetApi;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Paint;
import android.graphics.PixelFormat;
import android.graphics.Rect;
import android.os.Build;
import android.support.v7.app.AppCompatActivity;
import android.os.Bundle;
import android.util.DisplayMetrics;
import android.util.Log;
import android.view.GestureDetector;
import android.view.MotionEvent;
import android.view.SurfaceHolder;
import android.view.SurfaceView;
import android.view.View;
import android.view.ViewGroup;
import android.widget.RelativeLayout;

public class MainActivity extends AppCompatActivity implements View.OnTouchListener {
    public static final String TAG = "TAG";
    private SurfaceView sv;
    private SurfaceView sv_mini;
    private SurfaceHolder sfh;
    private SurfaceHolder holder;
    private RelativeLayout rl;
    private int lastX;
    private int lastY;
    private int screenWidth;
    private int screenHeight;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_main);
        DisplayMetrics dm = getResources().getDisplayMetrics();
        screenWidth = dm.widthPixels;
        screenHeight = dm.heightPixels - 50;
        getSupportActionBar().hide();
        sv = (SurfaceView) findViewById(R.id.sv);
        rl = (RelativeLayout) findViewById(R.id.rl);


        rl.setOnTouchListener(this);

        sfh = sv.getHolder();
        //对 surfaceView 进行操作
        sfh.addCallback(new SurfaceHolder.Callback() {
            @Override
            public void surfaceCreated(SurfaceHolder holder) {
                Canvas c = sfh.lockCanvas(new Rect(0, 0, 600, 600));
                //2.开画
                Paint p = new Paint();
                p.setColor(Color.RED);
                Rect aa = new Rect(0, 0, 600, 600);
                c.drawRect(aa, p);
                //3. 解锁画布   更新提交屏幕显示内容
                sfh.unlockCanvasAndPost(c);
            }

            @Override
            public void surfaceChanged(SurfaceHolder holder, int format, int width, int height) {

            }

            @Override
            public void surfaceDestroyed(SurfaceHolder holder) {

            }
        });// 自动运行surfaceCreated以及surfaceChanged

        sv_mini = (SurfaceView) findViewById(R.id.sv_mini);

//        sv.setZOrderOnTop(false);

        //这两个方法差不多，设置了就会浮现到顶部，但是，后面的看不见，要像下面设置为透明
        sv_mini.setZOrderOnTop(true);
        sv_mini.setZOrderMediaOverlay(true);

        holder = sv_mini.getHolder();

        holder.setFormat(PixelFormat.TRANSPARENT);
        sfh.setFormat(PixelFormat.TRANSPARENT);

        holder.addCallback(new SurfaceHolder.Callback() {
            @Override
            public void surfaceCreated(SurfaceHolder holder) {
                Canvas c = holder.lockCanvas(new Rect(0, 0, 400, 400));
                //2.开画
                Paint p = new Paint();
                p.setColor(Color.BLUE);
                Rect aa = new Rect(0, 0, 400, 400);
                c.drawRect(aa, p);
                //3. 解锁画布   更新提交屏幕显示内容
                holder.unlockCanvasAndPost(c);
            }

            @Override
            public void surfaceChanged(SurfaceHolder holder, int format, int width, int height) {

            }

            @Override
            public void surfaceDestroyed(SurfaceHolder holder) {

            }
        });
    }

    @TargetApi(Build.VERSION_CODES.HONEYCOMB)
    @Override
    public boolean onTouch(View v, MotionEvent event) {
        int ea = event.getAction();
        switch (ea) {
            case MotionEvent.ACTION_DOWN:
                lastX = (int) event.getRawX();
                lastY = (int) event.getRawY();
                break;
            /**
             * layout(l,t,r,b)
             * l  Left position, relative to parent
             t  Top position, relative to parent
             r  Right position, relative to parent
             b  Bottom position, relative to parent
             * */
            case MotionEvent.ACTION_MOVE:
                int dx = (int) event.getRawX() - lastX;
                int dy = (int) event.getRawY() - lastY;

                int left = v.getLeft() + dx;
                int top = v.getTop() + dy;
                int right = v.getRight() + dx;
                int bottom = v.getBottom() + dy;

                if (left < 0) {
                    left = 0;
                    right = left + v.getWidth();
                }

                if (right > screenWidth) {
                    right = screenWidth;
                    left = right - v.getWidth();
                }

                if (top < 0) {
                    top = 0;
                    bottom = top + v.getHeight();
                }

                if (bottom > screenHeight) {
                    bottom = screenHeight;
                    top = bottom - v.getHeight();
                }

                v.layout(left, top, right, bottom);

                Log.i("", "position：" + left + ", " + top + ", " + right + ", " + bottom);

                lastX = (int) event.getRawX();
                lastY = (int) event.getRawY();

                break;
            case MotionEvent.ACTION_UP:
                break;
        }
        return true;
    }


}
```

[Demo地址](https://github.com/lifengsofts/TestSurfaceView)下一期会从源码的角度解析为什么会有上述问题存在，敬请期待