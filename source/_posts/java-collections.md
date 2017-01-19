---
title: Java集合框架总结
date: 2016-10-31 14:17:01
categories: Java
tags: 
    - Collections
---

# 框架接口图

![](http://7qnc6h.com1.z0.glb.clouddn.com/java-collection-interface)

Java的集合框架分为两类Collection和Map

```java
Collection是集合，也就是存储对象的value

Map是用来存储键值对的容器

List：有序集合，可以储存null值，值可以重复

Set:无序集合，可以存储null值，值不能重复
SortedSet:可以排序的set，不能存储null值，值不能重复。并提供了可以获取子Set的方法
NavigableSet:提供方便搜索的一些方法，比如：返回小于某个元素的元素

Queue：队列，可以存储null值，值可以重复。先进先出，对头删除元素，队尾添加元素
Deque:双端队列，也就是队头，对尾都可以删除元素
```



测试List

```java
ArrayList<String> strings = new ArrayList<>();
strings.add("a");
strings.add("b");
strings.add(null);
strings.add(null);
strings.add("aa");

strings.forEach(e-> System.out.println(e));
```

输出：

```shell
a
b
null
null
aa
```

发现List确实是有序集合，且可以存储null值，并且值可以重复



测试Set

```java
HashSet<String> strings = new HashSet<>();
strings.add("a");
strings.add("b");
strings.add(null);
strings.add(null);
strings.add("aa");

strings.forEach(e-> System.out.println(e));
```

输出：

```java
null
aa
a
b
```

发现Set无序的，能储存null元素，值不能重复



测试Queue:

```java
HashSet<String> strings = new HashSet<>();
strings.add("a");
strings.add("b");
strings.add(null);
strings.add(null);
strings.add("aa");

strings.forEach(e-> System.out.println(e));
```

输出：

```shell
a
b
null
null
aa
```

可以发现输出和输入顺序都一样，并且能存储null。



测试双端队列：

```java
LinkedList<String> strings = new LinkedList<>();
strings.add("a");
strings.add("b");
strings.add(null);
strings.add(null);
strings.add("aa");

strings.addFirst("first");
strings.addLast("last");

strings.forEach(e -> System.out.println(e));

System.out.println("------------");

System.out.println(strings.pollFirst());
System.out.println(strings.pollLast());
```

输出：

```shell
first
a
b
null
null
aa
last
------------
first
last
```

可以发现我们不仅可以在首尾添加元素，也能在首尾删除元素。



测试SortedSet:

```java
TreeSet<String> strings = new TreeSet<>();
strings.add("a");
strings.add("b");
strings.add("aa");
strings.add("aa");

strings.forEach(e-> System.out.println(e));
```

输出：

```java
a
aa
b
```

说明是有序的，并且不能存储null，元素也不能重复。在比较元素的时候还可以传入自定义比较器：

```java
TreeSet<String> strings = new TreeSet<>((o1, o2) -> {
    if (o1.length() < o2.length())
        return -1;
    else if (o1.length() > o2.length())
        return 1;
    else
        return 0;
});

strings.add("a");
strings.add("b");
strings.add("aa");
strings.add("ab");
```

输出：

```shell
a
aa
```

我们发现相同的元素不能存储进去。



测试SortedSet获取子集：

```java
TreeSet<String> strings = new TreeSet<>();
strings.add("a");
strings.add("b");
strings.add("aa");
strings.add("ab");

SortedSet<String> strings1 = strings.subSet("a", "ab");
strings1.forEach(e -> System.out.println(e));
```

输出：

```shell
a
aa
```

subSet方法就定义到了SortedSet中，作用是返回元素a到元素ab中间的元素，不包括ab元素的不可修改set。



测试NavigableSet:

```java
TreeSet<String> strings = new TreeSet<>();
strings.add("a");
strings.add("b");
strings.add("aa");
strings.add("ab");

strings.forEach(e-> System.out.println(e));
System.out.println("------------");
System.out.println(strings.lower("ab"));
System.out.println(strings.higher("ab"));
```

输出：

```shell
a
aa
ab
b
------------
aa
b
```

可以使用快速的搜索方法，比如使用lower找小于ab的元素，使用higher找大于ab的元素。

# 集合框架完整图

![](http://7qnc6h.com1.z0.glb.clouddn.com/CollectionInterface-impl.png)

上面基本上列出了Java的所有集合框架了，但不包括并发包中的集合。下面我们一一讲解他们。

```java
AbstractCollection：是一个抽象类，实现了一些Collection接口的比较通用的方法，比如：contains，toArray，containsAll等方法，这样做的目的是，要再实现其他的集合，只需要继承AbstractCollection就行了，而不是用实现Collection接口，如果你觉得它的默认实现不好，可以在子类重写相应的方法。
  
ArrayDeque：是一个用循环数组实现的双端队列。实现了Deque接口。
PriorityQueu：允许高效删除最大优先级的元素的队列
  
AbstractList：是一个抽象类，实现了AbstractCollection，并填加了一些特有的List方法，比如：indexOf等方法。
ArrayList:一个使用数组实现的可增长有序列表。高效的索引
LinkedList:一个使用链表实现的可增长有序列表。高效的删除和添加

HashSet:使用Hash表实现的没有重复元素的无序集合
TreeSet:使用二叉树结构实现的有序集合
EnumSet:包含枚举类型的集合
LinkedHashSet:使用Hash表实现的有序集合
  
HashMap:使用Hash表实现存储key/value结构的映射表，键是键的hashCode，通常情况下能直接定位到他的值(get),特殊特殊情况下也只需要遍历当前Key所对应的桶，所以有很高的随机访问速度，但是顺序是不确定的，最多允许一条记录键为null，但可以运行多条值为null的记录。他不是线程安全的，如果需要则用ConcurrentHashMap或者使用Collections中的synchronizedMap方法是HashMap也能线程安全。
Hashtable:他是jdk以前提供的类，功能和HashMap类似，但是他是线程安全的，当然并发性能并没有ConcurrentHashMap好，所以新代码并不建议使用它。
TreeMap：使用二叉树数据结构实现存储key/value结构的有序映射表。能按照用户自定义的比较器排序。
EnumMap:高效存储枚举值的映射表
LinkedHashMap:使用Hash表实现存储key/value结构的能记住插入顺序的映射表
WeakHashMap:一种当值没有用的时候可以被拉机器回收的映射表
IdentiryHashMap:使用==而不是equals比较键值的映射表
```

## List

有些集合有listIterator方法，返回一个ListIterator对象。可以实现前后遍历元素。

```java
ArrayList<String> strings = new ArrayList<>();
strings.add("a123234324");
strings.add("b34");
strings.add("c");
strings.add("d4");
strings.add("e");

ListIterator<String> stringListIterator = strings.listIterator();
while (stringListIterator.hasNext()) {
    System.out.println(stringListIterator.next());
}

System.out.println("------");

while (stringListIterator.hasPrevious()) {
    System.out.println(stringListIterator.previous());
}
```

输出：

```shell
a123234324
b34
c
d4
e
------
e
d4
c
b34
a123234324
```

## 散列集

我们都知道数组和链表都可以安装我们想要的排序次序存放元素，但是如果想获取某个元素却又忘记了位置，区需要偏离每个元素，知道找到为止，如果集合元素太多了，那将有很多的性能问题。如果不在意元素的顺序，可以有很多种数据结构来实现这个需求。其中一种最常见的是散列表(hash table)。他为每个对象计算一个整数，称为散列码(hash code)，比如我们测试不同字符串的hash code:

| 字符串  | 散列码    |
| ---- | ------ |
| Lee  | 76268  |
| lee  | 107020 |
| eel  | 100300 |

所以说如果自定义类，就要实现HashCode方法，同时HashCode方法应与equals方法相兼容。

在Java中，散列表用链表数组实现，每个列表称为桶(bucket)。

如果要添加元素，他的基本步骤为则先要计算他的散列码，然后与桶的总数取余就可以得到保存这个元素的得桶索引。例如：如果某个对象的散列码是76268，并且有128个捅，所以对象应该保存于108号桶中，计算方式是76268%128=108，这样就可以快速定位到这个元素的位置，当然如果你幸运，那么该位置没有其他元素，此时就可以插入该元素。如果这个地方已经有一个元素了，这种情况下称为散列码冲突(hash collision)。这时就需要将要插入的元素与同种所有的元素就行了比较，看这个对象是否存在，则替换value。

从上面看到如果散列码分布合理，且桶数很大，发生散列码冲突的几率就越小，才能提高更好的性能。

> 注意：在JavaSE8中，当桶的元素个数达到8时会变为平衡二叉树。来提高效率。

其中有个很重要的指标就是桶数，通常设置为预计元素个数的75%~150%，且为一个素数。标准类库使用2的幂次方，默认值为16，下次会变为2^5。可以看到到JavaSE8的HashMap中初始化为16：

```java
static final int DEFAULT_INITIAL_CAPACITY = 1 << 4; // aka 16
```

如果元素装满了，就需要在散列(rehashed)，其实就是创建一个桶数更多的表，然后将原来的元素拷贝到新列表，并丢弃原来的列表。装填因子觉得什么时候在散列，默认是0.75也就是表中存储了超过75%的元素，这个表就会用双倍的桶数进行再散列。

我们可以通过构造函数传递初始容量和装填因子：

```java
new HashSet<String>(10, 0.8F);
```

## 树集

Treeset和HashSet十分类似，不过他改进了，是一个有序集合，任意顺序插入的元素遍历时都会自动按照排序好的顺序迭代。

```java
TreeSet<String> strings = new TreeSet<>();
strings.add("c");
strings.add("d4");
strings.add("a123234324");
strings.add("b34");
strings.add("e");

strings.forEach(e-> System.out.println(e));
```

输出：

```java
a123234324
b34
c
d4
e
```

排序使用的是树结构，当前实现用的是红黑树(red-black tree)。将一个元素添加到树要比添加到散列表中慢，因为他要排序，但是查找却要快的多，查找元素的时间为平均为log2N，例如：一棵树包含一个1000个元素，添加一个元素大约需要10次比较。

使用树集必须要保证元素可比较，元素都实现Comparable接口，或者在构造树集是指定一个Comparator比较器。

## 队列和双端队列

### 优先级队列

可以按照任意顺序插入，却总是按照排序的顺序进行检索，也就说无论何时调用remove方法，总会获得当前优先级队列中数字最小的元素，如果使用迭代器方式处理这些元素，并不需要排序，他使用一个优雅且高效的堆(heap)结构(是一个可以自我调整的二叉树，对树执行添加(add)和删除(remore)操作，可以让最小的元素移动到跟，而不必话费时间对元素排序)。

典型的优先队列使用场景是任务调用。每一个任务都有一个优先级，任务以随机添加到队列中，每当启动一个新任务时，都将优先级最高的任务从队列中删除，通常1为最高，所以也说将最小的元素删除。

```java
PriorityQueue<String> strings = new PriorityQueue<>();
strings.add("c");
strings.add("d4");
strings.add("a123234324");
strings.add("b34");
strings.add("e");

strings.forEach(e-> System.out.println(e));

System.out.println("-------");
System.out.println(strings.remove());
System.out.println("-------");

strings.forEach(e-> System.out.println(e));
```

输出：

```
a123234324
b34
c
d4
e
-------
a123234324
-------
b34
d4
c
e
```

可以看到删除的其实是最小的元素。

## LinkedHashSet

用来记住插入元素项顺序的集合。



# 映射

## HashMap

```java
HashMap<String, String> strings = new HashMap<>();
strings.put("3","c");
strings.put("4","d4");
strings.put("5","e");
strings.put("1","a123234324");
strings.put("2","b34");


strings.forEach((k,v)-> System.out.println(k+":"+v));


System.out.println("--------");

HashMap<Integer, String> hashMap = new HashMap<>();
hashMap.put(10,"d");
hashMap.put(2,"c");
hashMap.put(1,"a");
hashMap.put(3,"b");

hashMap.forEach((k,v)-> System.out.println(k+":"+v));
```

输出：

```
1:a123234324
2:b34
3:c
4:d4
5:e
--------
1:a
2:c
3:b
10:d
```

可以发现默认按照key排序的。

### 更新值

如我们需要使用某个Map统计某个单词出现的次数，可以这样做：

```java
private static void testWordCount() {
    String[] strings = {"a", "c", "d", "d", "c", "c", "a", "e"};
    HashMap<String, Integer> map = new HashMap<>();

    for (int i = 0; i < strings.length; i++) {
        countWord(map, strings[i]);
    }

    map.forEach((k, v) -> System.out.println(k + ":" + v));

}

private static void countWord(Map<String, Integer> map, String word) {
//        map.put(word,hashMap.get(word)+1); //第一次会空指针,可以通过下面的方式避免

//        map.put(word,hashMap.getOrDefault(word,0)+1); //可以这样

    //也可以这样
//        map.putIfAbsent(word,0); //当键不存在时才添加
//        map.put(word,hashMap.get(word)+1);

    //当然还有更好的方式
    map.merge(word, 1, Integer::sum); //如果不存在key word时，装入1，存在时将原来的值加1
}
```

输出：

```
a:2
c:3
d:2
e:1
```

## 弱散列映射

设计WeakHashMap是为了解决一个很特别的问题。假设一个键的最后一次引用没有了，那么也就无法删除对应的值了。











































