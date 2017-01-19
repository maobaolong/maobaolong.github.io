---
title: RecyclerView的使用解析
date: 2016-07-28 14:10:19
categories: Android
tags: 
    - RecyclerView
---
# 为什么要使用它

RecyclerView比ListView更灵活，比如我现在是显示一个List，过一会儿需要换成Grid格式，在这种情况下如果使用的是ListView，那我们需要换成GridView等，下面就来看看他的基本使用

# 添加控件到布局文件

```xml
<android.support.v7.widget.RecyclerView
    android:id="@+id/my_recycler_view"
    android:scrollbars="vertical"
    android:layout_width="match_parent"
    android:layout_height="match_parent"/>
```

# 设置布局管理器

所谓布局管理器就是你要告诉RecyclerView怎样去显示一个Item，因为他不像ListView那样一开始就定义死了怎么布局，比如ListView定义死了垂直布局，而GridView用于显示格式样式的布局。他提供了几个默认的实现

- LinearLayoutManager：垂直或水平滚动列表方式显示项目。
- GridLayoutManager：网格中显示项目。
- StaggeredGridLayoutManager：在分散对齐网格中显示项目。

我们这里用垂直布局管理器

```java
//设置布局管理器
LinearLayoutManager linearLayoutManager = new LinearLayoutManager(this);
rv.setLayoutManager(linearLayoutManager);
```

# 设置adapter

这一步和ListView这类的控件使用的方式差不多，也要设置一个适配器，告诉他数据源，他是继承RecyclerView.Adapter，我们需要实现三个方法

onCreateViewHolder：创建一个ViewHolder

onBindViewHolder：为ViewHolder绑定数据

getItemCount：整个列表的长度

```java
public class SimpleAdapter extends BaseRecyclerViewAdapter<String, SimpleAdapter.ViewHolder> {

    public SimpleAdapter(Context context) {
        super(context);
    }

    //下面两个方法想当与BaseAdapter的getView，只是他将创建view和设置view数据分开了
    @Override
    public ViewHolder onCreateViewHolder(ViewGroup parent, int viewType) {
        return new ViewHolder(LayoutInflater.from(context).inflate(android.R.layout.simple_list_item_1, parent, false));
    }

    @Override
    public void onBindViewHolder(ViewHolder holder, int position) {
        holder.bindView(getItem(position), position);
    }


    public class ViewHolder extends RecyclerView.ViewHolder {

        private final TextView tv;

        public ViewHolder(View itemView) {
            super(itemView);
            tv = (TextView) itemView.findViewById(android.R.id.text1);
        }

        public void bindView(final String item, final int position) {
            tv.setText(item);
            tv.setOnClickListener(new View.OnClickListener() {
                @Override
                public void onClick(View view) {
                    onItemClickListener.onItemClick(position);
                }
            });
        }
    }


}
```

这里我写了一个通用的Adapter

```java
package cn.woblog.recyclerviewsimple;

import android.content.Context;
import android.support.v7.widget.RecyclerView;

import java.util.ArrayList;
import java.util.List;

public abstract class BaseRecyclerViewAdapter<D, VH extends RecyclerView.ViewHolder> extends RecyclerView.Adapter<VH> {
    /**
     * 条目点击事件
     */
    protected OnItemClickListener onItemClickListener;

    protected final Context context;

    public void setOnItemClickListener(OnItemClickListener onItemClickListener) {
        this.onItemClickListener = onItemClickListener;
    }

    public BaseRecyclerViewAdapter(Context context) {
        this.context = context;
    }

    private List<D> data = new ArrayList<>();

    public List<D> getData() {
        return data;
    }

    public D getItem(int position) {
        return data.get(position);
    }

    //整个列表的长度，类似BaseAdapter的getCount
    @Override
    public int getItemCount() {
        return data.size();
    }

    public void setData(List<D> data) {
        this.data.clear();
        this.data.addAll(data);
        notifyDataSetChanged();
    }

    public void addData(List<D> data) {
        this.data.addAll(data);
        notifyDataSetChanged();
    }

    public interface OnItemClickListener {
        void onItemClick(int position);
    }
}

```

他定义了data列表对应最终的数据集合，定义了一个条目点击事件接口。接下来我们将整个适配器设置到RecyclerView

```java
//设置adapter
simpleAdapter = new SimpleAdapter(this);
rv.setAdapter(simpleAdapter);

simpleAdapter.setOnItemClickListener(this);

simpleAdapter.setData(getTestData());
```

到这一步我们这个相当于ListView的列表已经显示出来了

//无分割线图

但是还发现少点什么，对，就是分割线，RecyclerView的分割线实现起来要比ListView要难一点，我们需要通过addItemDecoration添加一个实现，居然没人默认的实现，真是醉了，这里我们先实现一个垂直列表的水平分割线，实现分割线需要继承ItemDecoration类，一般要复写如下方法：

- onDraw：改方法调用在drawChildren之前
- onDrawOver：该方法调用位于drawChildren之后
- getItemOffsets：通过outRect.set方法为每一个Item设置一个偏移量，用来绘制分割线

onDraw和onDrawOver一般只需要重写其中一个

```java
package cn.woblog.recyclerviewsimple;

import android.content.Context;
import android.content.res.TypedArray;
import android.graphics.Canvas;
import android.graphics.Rect;
import android.graphics.drawable.Drawable;
import android.support.v7.widget.RecyclerView;
import android.view.View;
import android.widget.LinearLayout;

public class ListItemDecoration extends RecyclerView.ItemDecoration {

    private static final int[] ATTRS = new int[]{
            android.R.attr.listDivider
    };

    private Drawable mDivider;

    private int mOrientation;

    public ListItemDecoration(Context context, int orientation) {
        final TypedArray a = context.obtainStyledAttributes(ATTRS);
        mDivider = a.getDrawable(0);
        a.recycle();
        setOrientation(orientation);
    }

    public void setOrientation(int orientation) {
        mOrientation = orientation;
    }

    @Override
    public void onDraw(Canvas c, RecyclerView parent) {
        if (mOrientation == LinearLayout.VERTICAL) {
            drawVertical(c, parent);
        } else {
            drawHorizontal(c, parent);
        }

    }

    public void drawVertical(Canvas c, RecyclerView parent) {
        final int left = parent.getPaddingLeft();
        final int right = parent.getWidth() - parent.getPaddingRight();

        //获取每个child个数
        final int childCount = parent.getChildCount();
        for (int i = 0; i < childCount; i++) {
            //获取到每一个child
            final View child = parent.getChildAt(i);

            //获取到每个child的params
            final RecyclerView.LayoutParams params = (RecyclerView.LayoutParams) child
                    .getLayoutParams();

            //计算分割线的顶部位置=当前Item的高度+当前item到顶部分割线的距离
            final int top = child.getBottom() + params.topMargin;

            //计算分割线的底部位置=top+分割线的真实高度+当前Item到底部分割线的距离
            final int bottom = top + mDivider.getIntrinsicHeight() + params.bottomMargin;

            //设置分割线线的边距
            mDivider.setBounds(left, top, right, bottom);
            mDivider.draw(c);
        }
    }

    public void drawHorizontal(Canvas c, RecyclerView parent) {
        final int top = parent.getPaddingTop();
        final int bottom = parent.getHeight() - parent.getPaddingBottom();

        final int childCount = parent.getChildCount();
        for (int i = 0; i < childCount; i++) {
            final View child = parent.getChildAt(i);
            final RecyclerView.LayoutParams params = (RecyclerView.LayoutParams) child
                    .getLayoutParams();
            final int left = child.getRight() + params.leftMargin;
            final int right = left + mDivider.getIntrinsicHeight() + params.rightMargin;
            mDivider.setBounds(left, top, right, bottom);
            mDivider.draw(c);
        }
    }

    @Override
    public void getItemOffsets(Rect outRect, int itemPosition, RecyclerView parent) {
        if (mOrientation == LinearLayout.VERTICAL) {
            outRect.set(0, 0, 0, mDivider.getIntrinsicHeight()); //dp单位
        } else {
            outRect.set(0, 0, mDivider.getIntrinsicWidth(), 0);
        }
    }
}

```

设置分割线

```java
//设置分割线
rv.addItemDecoration(new ListItemDecoration(this, LinearLayoutManager.VERTICAL));
```

到这里一个效果基本ListView差不多了

# 定制分割线样式

到这一步虽然分割线已经显示出来了，但是还是系统默认的，我们肯定有需要换颜色的需要对吧。我们从上面可以得知是使用了系统的listDivider属性，那要更改分割线肯定也是更改他了

item_divider.xml

```xml
<?xml version="1.0" encoding="utf-8"?>
<shape xmlns:android="http://schemas.android.com/apk/res/android"
       android:shape="rectangle">
    <solid android:color="#f00"/>
    <size android:height="1dp"/>
</shape>
```

我这里定义的高度为1dp，形状为矩形，大家可以根据自己的需求随便改。重要的步骤来了，就是要设置listDivider属性了，可以直接在application对应的theme里面设置，也可以对单个activity的theme设置

```xml
<style name="AppTheme" parent="Theme.AppCompat.Light.DarkActionBar">
    <item name="android:listDivider">@drawable/item_divider</item>
</style>
```

//有分割线图

//TODO listview更换方向

//GridView































# 常见错误

## item宽度一直是wrap_content

布局里面我们一直是写的match_parent，但是运行后却不是，最后发现是inflate时没有穿parent

```kotlin
//return ViewHolder(ViewGroup.inflate(parent.ctx, R.layout.item_weather, null),itemClick);
//return ViewHolder(View.inflate(parent.ctx, R.layout.item_weather, null),itemClick);
return ViewHolder(LayoutInflater.from(parent.context).inflate(R.layout.item_weather, parent,false),itemClick);
```

## ScrollView嵌套

对于这个问题，网上的解决办法五花八门，但都是重写layoutManager的onMeasure方法，这样会有各种问题，要么兼容性不好，要么有性能问题，好消息是在23.2.0后，google提供了官方解决方法，我们只需要

```kotlin
layoutManager.isAutoMeasureEnabled = true
```

这样就不会有问题了